import { REXConfiguration } from '@bric/rex-core/common'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule, dispatchEvent } from '@bric/rex-core/service-worker'

export interface REXSpiderIssue {
  url: string,
  message: string
}

// Default idle threshold (ms) before a spider run is declared stuck.
// Sized for slow networks: 30 intervals of the default 10s sleep_delay_ms,
// plus headroom for a single very slow fetch on a bad connection.
// Override per-deployment via server config: spider.stuck_timeout_ms.
const DEFAULT_STUCK_TIMEOUT_MS = 300_000

// Watchdog uses a dual-path design:
//   1. setTimeout fires while the service worker stays alive — covers the
//      common case where a fetch / loop is wedged but the SW is busy.
//   2. chrome.alarms fires after a SW restart — covers the case where the
//      SW gets killed mid-run (its in-memory state is gone, but the alarm
//      wakes it back up to clean up persisted state and emit completion).
// Both paths route through fireStuckForSpider(). A persisted state record
// in chrome.storage.local is the single source of truth for "is this
// spider's watchdog still armed"; deleting it after firing prevents either
// path from double-firing.
const WATCHDOG_ALARM_PREFIX = 'rex-spider-watchdog-'
const WATCHDOG_STORAGE_PREFIX = 'rex-spider-watchdog-state-'

interface WatchdogState {
  spiderName: string,            // original-case name(); slug derived at fire time
  runStartedAt: number,          // ms epoch
  lastProgressAt: number,        // ms epoch
  configuredTimeoutMs: number    // snapshot at run start
}

function watchdogAlarmName(name: string): string {
  return `${WATCHDOG_ALARM_PREFIX}${name}`
}

function watchdogStorageKey(name: string): string {
  return `${WATCHDOG_STORAGE_PREFIX}${name}`
}

function readWatchdogState(name: string): Promise<WatchdogState | null> {
  const key = watchdogStorageKey(name)
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => {
      const raw = items?.[key]
      if (raw && typeof raw === 'object') {
        resolve(raw as WatchdogState)
      } else {
        resolve(null)
      }
    })
  })
}

function writeWatchdogState(state: WatchdogState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [watchdogStorageKey(state.spiderName)]: state }, () => resolve())
  })
}

function clearWatchdogState(name: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(watchdogStorageKey(name), () => resolve())
  })
}

export class REXSpider {
  // Idle-since-last-progress threshold. Pushed in by REXSpiderModule from
  // server config; subclasses should not override directly.
  stuckTimeoutMs: number = DEFAULT_STUCK_TIMEOUT_MS

  // In-memory watchdog state for the fast (setTimeout) path. Reset per run.
  private watchdogTimerId: ReturnType<typeof setTimeout> | null = null
  private runStartedAt: number = 0
  private lastProgressAt: number = 0
  private onStuck: (() => void) | null = null
  private stuckFired: boolean = false

  // Subclasses call this when starting a sync run. onTimeout() runs if the
  // watchdog trips while the SW is still alive; subclass uses it to clear
  // its syncing flag, dispatch its *-complete event, and resolve its outer
  // promise so offboarding can proceed.
  // If the SW gets killed mid-run, the chrome.alarms survival path takes
  // over and dispatches *-complete via the module-level alarm handler — the
  // subclass's onTimeout closure is unreachable after a restart, but the
  // user-visible behavior (offboarding gets its completion event) is the
  // same. Idempotent — only the first trip per run takes effect.
  beginRun(onTimeout: () => void): void {
    this.endRun() // defensive: clear any leftover timer from a prior run
    const now = Date.now()
    this.runStartedAt = now
    this.lastProgressAt = now
    this.onStuck = onTimeout
    this.stuckFired = false
    this.scheduleWatchdog()
    // Persist state and arm the survival-path alarm. Fire-and-forget; the
    // setTimeout path will catch the common case before storage matters.
    writeWatchdogState({
      spiderName: this.name(),
      runStartedAt: now,
      lastProgressAt: now,
      configuredTimeoutMs: this.stuckTimeoutMs
    }).catch((err) => console.log(`[rex-spider] writeWatchdogState failed for ${this.name()}:`, err))
    this.scheduleAlarm()
  }

  // Subclasses call this after each successful per-item dispatch (e.g. after
  // a rex-conversation event is sent). Resets the idle clock so a healthy
  // slow run does not trip.
  noteProgress(): void {
    if (this.onStuck === null) return // run not active
    const now = Date.now()
    this.lastProgressAt = now
    this.scheduleWatchdog()
    // Mirror progress to storage and re-arm the alarm so the survival path
    // also resets its clock.
    writeWatchdogState({
      spiderName: this.name(),
      runStartedAt: this.runStartedAt,
      lastProgressAt: now,
      configuredTimeoutMs: this.stuckTimeoutMs
    }).catch((err) => console.log(`[rex-spider] writeWatchdogState failed for ${this.name()}:`, err))
    this.scheduleAlarm()
  }

  // Subclasses call this on natural completion (success OR handled error
  // path). Cancels both the in-memory timer and the survival-path alarm,
  // and clears persisted state.
  endRun(): void {
    if (this.watchdogTimerId !== null) {
      clearTimeout(this.watchdogTimerId)
      this.watchdogTimerId = null
    }
    this.onStuck = null
    chrome.alarms.clear(watchdogAlarmName(this.name())).catch(() => {
      // Ignore — alarm may not exist if beginRun was never called.
    })
    clearWatchdogState(this.name()).catch((err) =>
      console.log(`[rex-spider] clearWatchdogState failed for ${this.name()}:`, err)
    )
  }

  private scheduleWatchdog(): void {
    if (this.watchdogTimerId !== null) {
      clearTimeout(this.watchdogTimerId)
    }
    this.watchdogTimerId = setTimeout(() => {
      this.fireStuckFromMemory()
    }, this.stuckTimeoutMs)
  }

  private scheduleAlarm(): void {
    // chrome.alarms.create with the same name replaces the existing alarm.
    // Minimum granularity in production is ~30s; our 5-min default is safe.
    const delayMinutes = Math.max(this.stuckTimeoutMs / 60_000, 0.5)
    try {
      chrome.alarms.create(watchdogAlarmName(this.name()), { delayInMinutes: delayMinutes })
    } catch (err) {
      console.log(`[rex-spider] chrome.alarms.create failed for ${this.name()}:`, err)
    }
  }

  private fireStuckFromMemory(): void {
    if (this.stuckFired) return
    this.stuckFired = true

    const now = Date.now()
    const lastProgressMs = this.lastProgressAt
    const runStartMs = this.runStartedAt
    const callback = this.onStuck
    const configuredTimeoutMs = this.stuckTimeoutMs
    const spiderName = this.name()

    this.watchdogTimerId = null
    this.onStuck = null

    // Cancel the alarm — the in-memory path won the race.
    chrome.alarms.clear(watchdogAlarmName(spiderName)).catch(() => { /* no-op */ })
    clearWatchdogState(spiderName).catch(() => { /* no-op */ })

    dispatchStuckEvent({
      spiderName,
      runStartMs,
      lastProgressMs,
      configuredTimeoutMs,
      now
    })

    if (callback !== null) {
      try {
        callback()
      } catch (err) {
        console.log(`[rex-spider] Watchdog onTimeout callback for ${spiderName} threw:`, err)
      }
    }
  }

  checkLogin(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const loginListener = (message:any, sender:any, sendResponse:(response:any) => void):boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        if (message.messageType === 'spiderLoginResults' && message.spiderName === this.name()) {
          if (message.loggedIn === false) {
            resolve(false)
          } else {
            resolve(true)
          }

          chrome.runtime.onMessage.removeListener(loginListener)

          return true
        }

        return false
      }

      chrome.runtime.onMessage.addListener(loginListener)

      chrome.runtime.sendMessage({
        messageType: 'spiderCheckLogin',
        url: this.loginUrl()
      }).then((status) => {
        if (status === 'Loading') {
          // Wait for login to report on listener above...
        }
      })
    })
  }

  checkNeedsUpdate(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      resolve(false)
    })
  }

  fetchInitialUrls(): string[] {
    return []
  }

  processResults(url:string, results:any) { // eslint-disable-line @typescript-eslint/no-unused-vars,@typescript-eslint/no-explicit-any
    return new Promise<void>((resolve) => {
      resolve()
    })
  }

  matchesUrl(url:string): boolean { // eslint-disable-line @typescript-eslint/no-unused-vars
    return false
  }

  name():string {
    return 'REX Spider (Implement in subclasses)'
  }

  toString():string {
    return this.name()
  }

  loginUrl():string {
    return 'https://www.example.com'
  }

  urlPatterns():string[] {
    return []
  }
}

export interface REXSpiderPendingItem {
  url: string,
  spider: REXSpider
}

class REXSpiderModule extends REXServiceWorkerModule {
  registeredSpiders:REXSpider[] = []

  constructor() {
    super()
  }

  moduleName() {
    return 'SpiderModule'
  }

  setup() {
    this.refreshConfiguration()

    const urlPatterns:string[] = []

    for (let i = 0; i < this.registeredSpiders.length; i++) {
      const spider:REXSpider = this.registeredSpiders[i]

      urlPatterns.push(...spider.urlPatterns())
    }

    if (urlPatterns.length > 0) {
      chrome.webRequest.onCompleted.addListener(async function (details) {
        if (details.frameId > 0) {
          if (['sub_frame', 'main_frame', 'script'].includes(details.type)) {
            self.setTimeout(() => {
              chrome.scripting.executeScript({
                  target: {
                    tabId: details.tabId,
                    allFrames: false,
                    frameIds: [details.frameId]
                  },
                  files: ['/js/spider/bundle.js']
                })
            }, 2500);
          }
        }
      }, {
        urls: urlPatterns
      }, ['responseHeaders', 'extraHeaders'])

      chrome.webRequest.onErrorOccurred.addListener(async function (details) {
        const skip = ['net::ERR_ABORTED', 'net::ERR_CACHE_MISS']

        if (skip.includes(details.error)) {
          // Skip
        } else {
          console.log(`[rex-spider] Error on request:`)
          console.log(details)

          // for (let i = 0; i < this.registeredSpiders.length; i++) {
          //   const spider:REXSpider = this.registeredSpiders[i]

          //   if (spider.matchesUrl(details.url)) {
          //     console.log(`[Spider / ${spider.name()}] Error on request:`)
          //     console.log(details)
          //   }
          // }
        }
      }, {
        urls: urlPatterns
      }, ['extraHeaders'])
    }
  }

  refreshConfiguration() {
    rexCorePlugin.fetchConfiguration()
      .then((configuration:REXConfiguration) => {
        if (configuration !== undefined) {
          const spiderConfig = (configuration as any)['spider'] // eslint-disable-line @typescript-eslint/no-explicit-any

          if (spiderConfig !== undefined) {
            this.updateConfiguration(spiderConfig)

            return
          }
        }

        setTimeout(() => {
          this.refreshConfiguration()
        }, 1000)
      })
  }

  updateConfiguration(config:REXConfiguration) {
    const spiderConfig = config as unknown as { stuck_timeout_ms?: unknown }
    const raw = spiderConfig?.stuck_timeout_ms
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      for (const spider of this.registeredSpiders) {
        spider.stuckTimeoutMs = raw
      }
    }
  }

  handleMessage(message:any, sender:any, sendResponse:(response:any) => void):boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (message.messageType == 'checkSpidersReady') {
      const issues:REXSpiderIssue[] = []

      const response = {
        issues,
        ready: true
      }

      const toCheck:REXSpider[] = []

      toCheck.push(...this.registeredSpiders)

      const checkSpider = (sendResponse:any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          const spider = toCheck.pop()

          if (spider !== undefined) {
            spider.checkLogin()
              .then((ready:boolean) => {
                if (ready === false) {
                  response.issues.push({
                    message: `${spider.name()}: Login required. Please log in as soon as possible.`,
                    url: spider.loginUrl()
                  })

                  response.ready = false
                }

                checkSpider(sendResponse)
              })
          }
        }
      }

      checkSpider(sendResponse)

      return true
    } else if (message.messageType == 'checkSpidersNeedUpdate') {
      let response: boolean = false

      const toCheck:REXSpider[] = []

      toCheck.push(...this.registeredSpiders)

      const checkSpiderUpdates = (sendResponse:any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          const spider = toCheck.pop()

          if (spider !== undefined) {
            spider.checkNeedsUpdate()
              .then((needsUpdate:boolean) => {
                if (needsUpdate) {
                  response = true
                }

                checkSpiderUpdates(sendResponse)
              })
          }
        }
      }

      checkSpiderUpdates(sendResponse)

      return true
    } else if (message.messageType == 'startSpiders') {
      const response: boolean = false

      const toCheck:REXSpiderPendingItem[] = []

      this.registeredSpiders.forEach((spider:REXSpider) => {
          spider.fetchInitialUrls().forEach((url:string) => {
            toCheck.push({
              url,
              spider
            })
          })
      })

      const continueSpidering = (sendResponse:any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          const spiderItem = toCheck.pop()

          if (spiderItem !== undefined) {
            chrome.runtime.sendMessage({
              messageType: 'spiderContent',
              url: spiderItem.url
            })
          }
        }
      }

      const updateListener = (message:any, sender:any, sendResponse:(response:any) => void):boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (message.messageType === 'spiderSources') {
          this.registeredSpiders.forEach((spider:REXSpider) => {
            if (spider.name() === message.spiderName) {
              if (message.urls === undefined) {
                message.urls = []
              }

              for (const url of message.urls) {
                console.log(`[rex-spider] Pushing ${url} for ${spider} to check...`)

                toCheck.push({
                  url,
                  spider
                })
              }
            }
          })

          continueSpidering(sendResponse)

          return true
        } else if (message.messageType === 'spiderResults') {
          dispatchEvent({
            name: 'rex-spider-result',
            source: message.spiderName,
            payload: message.payload
          })

          continueSpidering(sendResponse)

          return true
        }

        return false
      }

      chrome.runtime.onMessage.addListener(updateListener)

      continueSpidering(sendResponse)

      return true
    }

    return false
  }

  registerSpider(spider:REXSpider) {
    if (this.registeredSpiders.includes(spider) === false) {
      this.registeredSpiders.push(spider)
    }
  }

  unregisterSpider(spider:REXSpider) {
    if (this.registeredSpiders.includes(spider)) {
      this.registeredSpiders = this.registeredSpiders.filter(item => item !== spider)
    }
  }
}

const plugin = new REXSpiderModule()

registerREXModule(plugin)

// Watchdog event helpers (shared by both fast-path and survival-path).

interface DispatchStuckArgs {
  spiderName: string
  runStartMs: number
  lastProgressMs: number
  configuredTimeoutMs: number
  now: number
}

function dispatchStuckEvent(args: DispatchStuckArgs): void {
  let extensionVersion: string | null = null
  try {
    extensionVersion = chrome.runtime.getManifest().version
  } catch (_err) { // eslint-disable-line @typescript-eslint/no-unused-vars
    // No-op: diagnostic field, not load-bearing.
  }

  const userAgent: string | null =
    (self as unknown as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? null

  dispatchEvent({
    name: 'pdk-app-event',
    event_name: 'rex-spider-stuck',
    event_details: {
      spider: args.spiderName.toLowerCase(),
      run_started_at: args.runStartMs,
      last_progress_at: args.lastProgressMs,
      idle_ms_at_trip: args.now - args.lastProgressMs,
      configured_timeout_ms: args.configuredTimeoutMs,
      date: args.now,
      had_any_progress: args.lastProgressMs > args.runStartMs,
      extension_version: extensionVersion,
      user_agent: userAgent
    }
  })
}

// Survival-path: chrome.alarms wakes the SW after it was killed mid-run.
// In-memory state from the prior run is gone, so we rebuild from storage,
// emit the stuck diagnostic + the per-spider *-complete event (so Keystone
// offboarding can advance), and clear persisted state so the next run
// starts clean. Listener registered top-level so it survives SW restarts.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(WATCHDOG_ALARM_PREFIX)) return
  const spiderName = alarm.name.slice(WATCHDOG_ALARM_PREFIX.length)

  readWatchdogState(spiderName).then((state) => {
    if (state === null) {
      // Run already ended cleanly (endRun cleared storage), or the fast
      // path already fired and cleaned up. Nothing to do.
      return
    }

    const now = Date.now()

    dispatchStuckEvent({
      spiderName: state.spiderName,
      runStartMs: state.runStartedAt,
      lastProgressMs: state.lastProgressAt,
      configuredTimeoutMs: state.configuredTimeoutMs,
      now
    })

    // Dispatch the per-spider completion event so Keystone offboarding
    // (which listens for rex-spider-<name>-complete) can advance.
    // crawled_count is unknown after a SW restart; report 0.
    dispatchEvent({
      name: 'pdk-app-event',
      event_name: `rex-spider-${state.spiderName.toLowerCase()}-complete`,
      event_details: {
        crawled_count: 0,
        date: now,
        recovered_via: 'watchdog'
      }
    })

    // The in-memory `syncing` flag on subclasses is already false after a
    // SW restart (default), so no storage clearing is needed.
    clearWatchdogState(state.spiderName).catch((err) =>
      console.log(`[rex-spider] clearWatchdogState (alarm path) failed for ${state.spiderName}:`, err)
    )
  }).catch((err) => {
    console.log(`[rex-spider] readWatchdogState failed for ${spiderName}:`, err)
  })
})

export default plugin

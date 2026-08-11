import { REXConfiguration } from '@bric/rex-core/common'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule, dispatchEvent } from '@bric/rex-core/service-worker'
import { Conversation, DateString } from '@bric/rex-types/types'

import { REXSpiderModuleConfiguration, REXSpiderConfiguration } from './types.mjs'

export interface REXSpiderIssue {
  url: string,
  message: string
}

export interface REXSpiderCrawlResult {
  sitesCrawled: string[],
  issues: REXSpiderIssue[]
}

export interface REXSpiderCrawlInspection {
  id: string,
  refresh: boolean,
  conversation?: Conversation,
  lookupDate: DateString
}

export class REXSpider {
  private enabled: boolean = true
  private startCrawl: number | null = null
  private endCrawl: number | null = null
  private haltOnError: boolean = true
  private timeAnchor: 'install' | 'runtime' | 'absolute' = 'runtime'

  private sleepDuration: number = 300000 // 5 minutes

  private crawlDelay: number = 30000

  private crawling: boolean = false

  updateConfiguration(configuration:REXSpiderConfiguration) {
    if (configuration.enabled !== undefined) {
      this.enabled = configuration.enabled
    }

    if (configuration.start !== undefined) {
      this.startCrawl = configuration.start
    }

    if (configuration.end !== undefined) {
      this.endCrawl = configuration.end
    }

    if (configuration['time_anchor'] !== undefined) {
      this.timeAnchor = configuration['time_anchor']
    }

    if (configuration['crawl_delay'] !== undefined) {
      this.crawlDelay = configuration['crawl_delay']
    }

    if (configuration['halt_on_error'] === false) {
      this.haltOnError = false
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  fetchCrawlDelay(): number {
    return this.crawlDelay
  }

  isCrawling(): boolean {
    return this.crawling
  }

  continueAfterError(): boolean {
    return this.haltOnError === false
  }

  private prepareCrawl() {
    const storeMessage = {
      messageType: 'storeValue',
      key: `rex-spider-${this.identifier()}-last-crawl`,
      value: Date.now()
    }

    rexCorePlugin.handleMessage(storeMessage, this, (response) => {  // eslint-disable-line @typescript-eslint/no-unused-vars
      this.crawling = true
    })
  }

  sleepElapsed(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const fetchLastCrawl = {
        messageType: 'fetchValue',
        key: `rex-spider-${this.identifier()}-last-crawl`
      }

      rexCorePlugin.handleMessage(fetchLastCrawl, this, (response) => {
        let lastCrawlStarted = 0 

        if (response !== null) {
          lastCrawlStarted = response
        }

        const now: number = Date.now()

        if ((now - lastCrawlStarted) > this.sleepDuration) {
          resolve(true)
        }

        resolve(false)
      })
    })
  }

  crawlWindowStart(): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      if (this.startCrawl === null) {
        resolve(null)
      } else if (this.timeAnchor === 'install') {
        const message = {
          messageType: 'getInstallTime'
        }

        rexCorePlugin.handleMessage(message, this, (response: number | null) => {
          if (response === null || this.startCrawl === null) {
            resolve(null)
          } else {
            const installed:number = (response as number)

            resolve(Math.floor(installed + this.startCrawl))
          }
        })
      } else if (this.timeAnchor === 'absolute') {
        resolve(this.startCrawl)
      } else { // 'runtime'
        resolve(Date.now() + this.startCrawl)
      }
    })
  }

  crawlWindowEnd(): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      if (this.endCrawl === null) {
        resolve(null)
      } else if (this.timeAnchor === 'install') {
        const message = {
          messageType: 'getInstallTime'
        }

        rexCorePlugin.handleMessage(message, this, (response: number | null) => {
          if (response === null || this.endCrawl === null) {
            resolve(null)
          } else {
            const installed:number = (response as number)

            resolve(Math.floor(installed + this.endCrawl))
          }
        })
      } else if (this.timeAnchor === 'absolute') {
        resolve(this.endCrawl)
      } else { // 'runtime'
        resolve(Date.now() + this.endCrawl)
      }
    })
  }

  crawlWindowContains(timestamp:number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.crawlWindowStart().then((startTime:number | null) => {
        if (startTime !== null && timestamp < startTime) {
          resolve(false)
        } else {
          this.crawlWindowEnd().then((endTime:number | null) => {
            if (endTime !== null && timestamp > endTime) {
              resolve(false)
            } else {
              resolve(true)
            }
          })
        }
      })
    })
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

  fetchInitialUrls(): string[] {
    return []
  }

  processResults(url:string, results:any) { // eslint-disable-line @typescript-eslint/no-unused-vars,@typescript-eslint/no-explicit-any
    return new Promise<void>((resolve) => {
      resolve()
    })
  }

  name():string {
    return 'REX Spider (Implement in subclasses)'
  }

  identifier():string {
    return 'rex-spider'
  }

  toString():string {
    return `${this.name()} (${this.identifier()})`
  }

  loginUrl():string {
    return 'https://www.example.com'
  }

  urlPatterns():string[] {
    return []
  }

  allowedUrls():string[] {
    return []
  }

  // Signals that this spider has collected everything in scope — either it
  // paged back to the end of the account ('exhausted') or it reached the
  // configured collection floor ('date-floor'). This is distinct from the
  // per-run *-complete event, which fires at the end of every pass regardless
  // of whether the account is fully captured.
  signalAccountCollectionComplete(details:object = {}):void {
    dispatchEvent({
      name: 'pdk-app-event',
      event_name: `rex-spider-${this.identifier()}-account-complete`,
      event_details: {
        ...details,
        date: Date.now()
      }
    })
  }

  signalCrawlComplete(crawledCount: number, crawledIds: string[] = [], reason:string = 'None given') {
    dispatchEvent({
      name: 'pdk-app-event',
      event_name: `rex-spider-${this.identifier()}-complete`,
      event_details: {
        crawled_count: crawledCount,
        crawled_ids: crawledIds,
        reason,
        date: Date.now() + 1000
      }
    })

    this.crawling = false
  }

  doBackgroundCrawl():Promise<REXSpiderCrawlResult> {
    this.prepareCrawl()

    return new Promise<REXSpiderCrawlResult>((resolve) => {
      resolve({
        sitesCrawled: [this.identifier()],
        issues: []
      })
    })
  }

  private fetchUploadKey(convoId: string, updated:DateString): string {
    const timestamp:number = Math.floor(updated.timestamp())

    return `rex-spider-${this.identifier()}-conversation-upload-${convoId}-${timestamp}`
  }

  checkIfAlreadyTransmitted(identifier: string, updated:DateString): Promise<boolean> {
    const uploadKey = this.fetchUploadKey(identifier, updated)

    return new Promise<boolean>((resolve) => {
      const fetchTransmission = {
        messageType: 'fetchValue',
        key: uploadKey
      }

      rexCorePlugin.handleMessage(fetchTransmission, this, (response) => {
        if (response !== null) {
          resolve(true)
        } else {
          resolve(false)
        }
      })
    })
  }

  logTransmitted(identifier: string, updated:DateString): Promise<void> {
    const uploadKey = this.fetchUploadKey(identifier, updated)

    return new Promise<void>((resolve) => {
      const logTimestamp = {
        messageType: 'storeValue',
        key: uploadKey,
        value: Date.now()
      }

      rexCorePlugin.handleMessage(logTimestamp, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
        resolve()
      })
    })
  }
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

  updateConfiguration(config:REXSpiderModuleConfiguration) {
    const spiderConfigs = config.spiders

    if (spiderConfigs !== undefined) {
      const defaultConfig:REXSpiderConfiguration | undefined = spiderConfigs['default']

      for (const spider of this.registeredSpiders) {
        const spiderConfig:REXSpiderConfiguration|undefined = spiderConfigs[spider.identifier()]

        if (spiderConfig !== undefined) {
          spider.updateConfiguration(spiderConfig)
        } else if (defaultConfig !== undefined) {
          spider.updateConfiguration(defaultConfig)
        }
      }
    }
  }

  handleMessage(message:any, sender:any, sendResponse:(response:any) => void):boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (message.messageType == 'beginBackgroundCrawls') {
      // Cleaning up code to make it more explicit which operations are being run when.

      const response:REXSpiderCrawlResult = {
        sitesCrawled: [],
        issues: []
      }

      const toCheck:REXSpider[] = []

      for (const spider of this.registeredSpiders) {
        if (spider.isEnabled() === false) {
          // Do not log - spider is disabled.
        } else {
          console.log(`[rex-spider] Adding ${spider.identifier()} to check...`)

          toCheck.push(spider)
        }
      }

      const startNextCrawl = (sendResponse:any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        console.log(`[rex-spider] ${toCheck.length} sites left to crawl...`)

        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          const spider = toCheck.pop()
          
          if (spider !== undefined) {
            if (spider.isCrawling()) {
              console.log(`[rex-spider: ${spider.identifier()}] Still crawling. Skipping this round...`)

              spider.signalCrawlComplete(-1, [], `[${spider.identifier()}] Still crawling.`)
            } else {
              console.log(`[rex-spider: ${spider.identifier()}] Starting crawl...`)

              spider.sleepElapsed().then((elapsed:boolean) => {
                if (elapsed) {
                  spider.doBackgroundCrawl()
                    .then((result:REXSpiderCrawlResult) => {
                      if (response.sitesCrawled.includes(spider.identifier()) === false) {
                        response.sitesCrawled.push(spider.identifier())
                      }

                      for (const issue of result.issues) {
                        response.issues.push(issue)
                      }

                      console.log(`[rex-spider: ${spider.identifier()}] Finished crawl...`)

                      startNextCrawl(sendResponse)
                    })
                } else {
                  console.log(`[rex-spider: ${spider.identifier()}] Too soon to crawl again. Skipping this round...`)
                }
              }).catch(() => {
                console.log(`[rex-spider: ${spider.identifier()}] Too soon to crawl again. Skipping this round...`)
    
                spider.signalCrawlComplete(-1, [], `[${spider.identifier()}] Too soon to crawl again.`)

                startNextCrawl(sendResponse)
              })
            }
          }
        }
      }

      startNextCrawl(sendResponse)

      return true
    } else if (message.messageType === 'fetchAllowedURLs') {
      const allowedUrls:string[] = []

      for (const spider of this.registeredSpiders) {
        if (spider.isEnabled()) {
          for (const url of spider.allowedUrls()) {
            if (allowedUrls.includes(url) === false) {
              allowedUrls.push(url)
            }
          }
        }
      }

      sendResponse(allowedUrls)

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

export default plugin

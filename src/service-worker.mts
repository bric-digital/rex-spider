import { REXConfiguration } from '@bric/rex-core/common'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule, dispatchEvent } from '@bric/rex-core/service-worker'

export interface REXSpiderIssue {
  url: string,
  message: string
}

export class REXSpider {
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

  updateConfiguration(config:REXConfiguration) { // eslint-disable-line @typescript-eslint/no-unused-vars

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
                    message: `${spider.name()}: Login required.`,
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

                  checkSpiderUpdates(sendResponse)
                }
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

export default plugin

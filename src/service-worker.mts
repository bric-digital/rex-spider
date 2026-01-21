import { WebmunkConfiguration } from '@bric/webmunk-core/extension'
import webmunkCorePlugin, { WebmunkServiceWorkerModule, registerWebmunkModule } from '@bric/webmunk-core/service-worker'

export class WebmunkSpider {
  checkLogin(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const loginListener = (message:any, sender:any, sendResponse:(response:any) => void):boolean => {
        if (message.messageType === 'spiderResults' && message.spiderName === this.name()) {
          if (message.loggedIn) {
            resolve(true)
          } else {
            resolve(false)
          }

          chrome.runtime.onMessage.removeListener(loginListener)
        }

        return true
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

  processResults(url:string, results) {
    return new Promise<void>((resolve) => {
      resolve()
    })
  }

  matchesUrl(url:string): boolean {
    return false
  }

  name(): string {
    return 'Webmunk Spider (Implement in subclasses)'
  }

  loginUrl(): string {
    return 'https://www.example.com'
  }

  urlPatterns(): string[] {
    return []
  }
}

export interface WebmunkSpiderPendingItem {
  url: string,
  spider: WebmunkSpider
}

class WebmunkSpiderModule extends WebmunkServiceWorkerModule {
  registeredSpiders:WebmunkSpider[] = []

  constructor() {
    super()
  }

  moduleName() {
    return 'SpiderModule'
  }

  setup() {
    this.refreshConfiguration()

    let urlPatterns = []

    for (let i = 0; i < this.registeredSpiders.length; i++) {
      const spider:WebmunkSpider = this.registeredSpiders[i]

      urlPatterns.push(...spider.urlPatterns())
    }

    chrome.webRequest.onCompleted.addListener(async function (details) {
      if (details.frameId > 0) {
        console.log('DETAILS')
        console.log(details)

        chrome.scripting.executeScript({
          target: {
            tabId: details.tabId, // eslint-disable-line object-shorthand
            allFrames: false,
            frameIds: [details.frameId]
          },
          files: ['/js/spider/bundle.js']
        })
      }
    }, {
      urls: urlPatterns
    }, ['responseHeaders', 'extraHeaders'])

    chrome.webRequest.onErrorOccurred.addListener(async function (details) {
      const skip = ['net::ERR_ABORTED', 'net::ERR_CACHE_MISS']

      if (skip.includes(details.error)) {
        // Skip
      } else {
        for (let i = 0; i < this.registeredSpiders.length; i++) {
          const spider:WebmunkSpider = this.registeredSpiders[i]

          if (spider.matchesUrl(details.url)) {
            console.log(`[Spider / ${spider.name()}] Error on request:`)
            console.log(details)
          }
        }
      }
    }, {
      urls: urlPatterns
    }, ['extraHeaders'])
  }

  refreshConfiguration() {
    webmunkCorePlugin.fetchConfiguration()
      .then((configuration:WebmunkConfiguration) => {
        if (configuration !== undefined) {
          const spiderConfig = configuration['spider']

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

  updateConfiguration(config) {

  }

  handleMessage(message:any, sender:any, sendResponse:(response:any) => void):boolean {
    if (message.messageType == 'checkSpidersReady') {
      const response = {
        issues:[],
        ready: true
      }

      let toCheck:WebmunkSpider[] = []

      toCheck.push(...this.registeredSpiders)

      const checkSpider = (sendResponse) => {
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          let spider = toCheck.pop()

          spider.checkLogin()
            .then((ready:boolean) => {
              if (ready === false) {
                response.issues.push({
                  message: `${spider.name()}: Login required.`,
                  url: spider.loginUrl()
                })

                response.ready = false

                checkSpider(sendResponse)
              }
            })
        }
      }

      checkSpider(sendResponse)

      return true
    } else if (message.messageType == 'checkSpidersNeedUpdate') {
      let response: boolean = false

      let toCheck:WebmunkSpider[] = []

      toCheck.push(...this.registeredSpiders)

      const checkSpiderUpdates = (sendResponse) => {
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          let spider = toCheck.pop()

          spider.checkNeedsUpdate()
            .then((needsUpdate:boolean) => {
              if (needsUpdate) {
                response = true

                checkSpiderUpdates(sendResponse)
              }
            })
        }
      }

      checkSpiderUpdates(sendResponse)

      return true
    } else if (message.messageType == 'startSpiders') {
      let response: boolean = false

      let toCheck:WebmunkSpiderPendingItem[] = []

      this.registeredSpiders.forEach((spider:WebmunkSpider) => {
          spider.fetchInitialUrls().forEach((url:string) => {
            toCheck.push({
              url,
              spider
            })
          })
      })

      const continueSpidering = (sendResponse) => {
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          let spiderItem = toCheck.pop()

          chrome.runtime.sendMessage({
            messageType: 'spiderContent',
            url: spiderItem.url
          }).then((results) => {
            spiderItem.spider.processResults(spiderItem.url, results)
              .then(() => {
                continueSpidering(sendResponse)
              })
          })
        }
      }

      continueSpidering(sendResponse)

      return true
    }

    return false
  }

  registerSpider(spider:WebmunkSpider) {
    if (this.registeredSpiders.includes(spider) === false) {
      this.registeredSpiders.push(spider)
    }
  }

  unregisterSpider(spider:WebmunkSpider) {
    if (this.registeredSpiders.includes(spider)) {
      this.registeredSpiders = this.registeredSpiders.filter(item => item !== spider)
    }
  }
}

const plugin = new WebmunkSpiderModule()

registerWebmunkModule(plugin)

export default plugin

import { REXConfiguration } from '@bric/rex-core/extension'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule, dispatchEvent } from '@bric/rex-core/service-worker'

export class REXSpider {
  checkLogin(): Promise<boolean> {
    console.log('fecthing promise')

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

  processResults(url:string, results) { // eslint-disable-line @typescript-eslint/no-unused-vars
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

    const urlPatterns = []

    for (let i = 0; i < this.registeredSpiders.length; i++) {
      const spider:REXSpider = this.registeredSpiders[i]

      urlPatterns.push(...spider.urlPatterns())
    }

    chrome.webRequest.onCompleted.addListener(async function (details) {
      if (details.frameId > 0) {
        if (['sub_frame', 'main_frame', 'script'].includes(details.type)) {
          console.log('IFRAME')
          console.log(details)

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
        console.log(`[Spider] Error on request:`)
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

  refreshConfiguration() {
    rexCorePlugin.fetchConfiguration()
      .then((configuration:REXConfiguration) => {
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

  updateConfiguration(config) { // eslint-disable-line @typescript-eslint/no-unused-vars

  }

  handleMessage(message:any, sender:any, sendResponse:(response:any) => void):boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log('[spider service-worker] MESSAGE')
    console.log(message)

    if (message.messageType == 'checkSpidersReady') {
      const response = {
        issues:[],
        ready: true
      }

      const toCheck:REXSpider[] = []

      toCheck.push(...this.registeredSpiders)

      const checkSpider = (sendResponse) => {
        if (toCheck.length === 0) {
          console.log('all checked - on to next step')
          sendResponse(response)
        } else {
          const spider = toCheck.pop()

          console.log(`checked ${spider} login`)

          spider.checkLogin()
            .then((ready:boolean) => {
              console.log(`check complete ${spider} login: ${ready}`)

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

      checkSpider(sendResponse)

      return true
    } else if (message.messageType == 'checkSpidersNeedUpdate') {
      let response: boolean = false

      const toCheck:REXSpider[] = []

      toCheck.push(...this.registeredSpiders)

      const checkSpiderUpdates = (sendResponse) => {
        if (toCheck.length === 0) {
          console.log(`needsUpdate: done`)
          sendResponse(response)
        } else {
          const spider = toCheck.pop()

          spider.checkNeedsUpdate()
            .then((needsUpdate:boolean) => {
              console.log(`needsUpdate: ${spider} ${needsUpdate}`)
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

      const continueSpidering = (sendResponse) => {
        if (toCheck.length === 0) {
          sendResponse(response)
        } else {
          const spiderItem = toCheck.pop()

          chrome.runtime.sendMessage({
            messageType: 'spiderContent',
            url: spiderItem.url
          })
        }
      }

      console.log('Setting up listener for spiderSources')

      const updateListener = (message:any, sender:any, sendResponse:(response:any) => void):boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
        console.log('updateListener MESSAGE')
        console.log(message)

        if (message.messageType === 'spiderSources') {
          this.registeredSpiders.forEach((spider:REXSpider) => {
            if (spider.name() === message.spiderName) {
              if (message.urls === undefined) {
                message.urls = []
              }

              for (const url of message.urls) {
                console.log(`pushing ${url} for ${spider} to check...`)

                toCheck.push({
                  url,
                  spider
                })
              }
            }
          })

          continueSpidering(sendResponse)

          return
        } else if (message.messageType === 'spiderResults') {
          dispatchEvent({
            name: 'rex-spider-result',
            source: message.spiderName,
            payload: message.payload
          })

          continueSpidering(sendResponse)

          return
        }
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

import { WebmunkConfiguration } from '@bric/webmunk-core/extension'
import webmunkCorePlugin, { WebmunkServiceWorkerModule, registerWebmunkModule } from '@bric/webmunk-core/service-worker'

export class WebmunkSpider {
  checkLogin(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      resolve(false)
    })
  }

  fetchUrls(): string[] {
    return []
  }

  processUrlContent(url:string, content:string): string[] {
    return []
  }

  name(): string {
    return 'Webmunk Spider (Implement in subclasses)'
  }

  loginUrl(): string {
    return 'https://www.example.com'
  }
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
    if (message.messageType == 'checkSpiderReady') {
      const response = {
        issues:[],
        ready: true
      }

      chrome.runtime.sendMessage({
        messageType: 'openWindow'
      }).then(async (windowId:number) => {
        for (let i = 0; i < this.registeredSpiders.length; i++) {
          const spider:WebmunkSpider = this.registeredSpiders[i]

          let ready = await spider.checkLogin()

          if (ready === false) {
            response.issues.push({
              message: `${spider.name()}: Login required.`,
              url: spider.loginUrl()
            })

            response.ready = false
          }
        }

        sendResponse(response)
      })

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

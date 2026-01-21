import $ from 'jquery'

import { webmunkCorePlugin, WebmunkExtensionModule, registerWebmunkModule, WebmunkUIDefinition } from '@bric/webmunk-core/extension'

class WebmunkSpiderExtensionModule extends WebmunkExtensionModule {
  setup() {
    chrome.runtime.onMessage.addListener((message:any, sender:any, sendResponse:(response:any) => void):boolean => {
      if (message.messageType === 'spiderContent') {
        const url = message.url

        $('#spider_frame').attr('src', url)

        return true;
      } else if (message.messageType === 'spiderCheckLogin') {
        const url = message.url

        $('#spider_frame').attr('src', url)

        sendResponse('Loading')

        return true;
      }

      return false
    })
  }

  fetchHtmlInterface(identifier:string):string|null {
    return  '<div class="col-12">' +
            '<p><em>Welcome message goes here&#8230;</em></p>' +
            '<div id="outstanding_issues">' +
            '<p>Please complete the following tasks:</p>' +
            '<ul id="issue_list"></ul>' +
            '</div>' +
            '<div id="start_spidering">' +
            '<p>You are ready to begin. Please tap the button below to get started</p>' +
            '<button id="start_spidering_btn" class="btn btn-primary">Begin&#8230;</button>' +
            '</div>' +
            '<div id="spidering_progress">' +
            '[progress bar]' +
            '</div>' +
            '<iframe id="spider_frame" style="display: block; height: 200px; width: 100%; opacity: 1.0; border: thin solid blue;"></iframe>' +
            '</div>'
  }

  activateInterface(uiDefinition:WebmunkUIDefinition):boolean {
    console.log('activateInterface')
    console.log(uiDefinition)

    const me = this  // eslint-disable-line @typescript-eslint/no-this-alias

    if (uiDefinition.identifier === 'spider') {
      chrome.runtime.sendMessage({
        'messageType': 'checkSpidersReady'
      }).then((response) => {
        console.log('checkSpidersReady:')
        console.log(response)

        $('#outstanding_issues').hide()
        $('#start_spidering').hide()
        $('#spidering_progress').hide()

        if (response['issues'].length > 0) {
          let updatedHtml = ''

          response['issues'].forEach((item, index) => {
            updatedHtml += `<li><a href="${item.url}" target="_blank">${item.message}</li>\n`
          })

          $('#issue_list').html(updatedHtml)

          $('#outstanding_issues').show()
        } else {
          chrome.runtime.sendMessage({
            'messageType': 'checkSpidersNeedUpdate'
          }).then((needsUpdate:boolean) => {
            if (needsUpdate) {
              $('#start_spidering_btn').off('click')

              $('#start_spidering_btn').on('click', (eventObj) => {
                chrome.runtime.sendMessage({
                  'messageType': 'startSpiders'
                }).then(() => {
                  $($('#start_spidering_btn').prop('disabled', true))
                })
              })

              $('#start_spidering').show()
            }
          })
        }
      })

     return true
    }

    return false
  }
}

const spiderModule = new WebmunkSpiderExtensionModule()

registerWebmunkModule(spiderModule)

export default spiderModule


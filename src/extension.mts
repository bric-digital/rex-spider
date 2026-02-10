import $ from 'jquery'

import { REXExtensionModule, registerREXModule, REXUIDefinition } from '@bric/rex-core/extension'

class REXSpiderExtensionModule extends REXExtensionModule {
  setup() {
    chrome.runtime.onMessage.addListener((message:any, sender:any, sendResponse:(response:any) => void):boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (message.messageType === 'spiderContent') {
        const url = message.url

        $('#spider_frame').attr('src', url)

        return true;
      } else if (message.messageType === 'spiderCheckLogin') {
        const url = message.url

        console.log(`[extension] loading login URL ${url}`)

        $('#spider_frame').attr('src', url)

        sendResponse('Loading')

        return true;
      }

      return false
    })
  }

  fetchHtmlInterface(identifier:string):string|null {
    if (identifier === 'spider') {
      return  '<div class="col-12">' +
              '  <p><em>Welcome message goes here&#8230;</em></p>' +
              '  <div id="outstanding_issues">' +
              '    <p>Please complete the following tasks:</p>' +
              '    <ul id="issue_list"></ul>' +
              '  </div>' +
              '  <div id="start_spidering" class="mb-3">' +
              '    <p>You are ready to begin. Please tap the button below to get started</p>' +
              '    <button id="start_spidering_btn" class="btn btn-primary">Begin&#8230;</button>' +
              '  </div>' +
              '  <div id="spidering_progress" class="mb-3">' +
              '    [progress bar]' +
              '  </div>' +
              '  <iframe id="spider_frame" style="display: block; height: 400px; width: 100%; opacity: 1.0; border: thin solid blue;"></iframe>' +
              '</div>'
    }

    return  '<div class="col-12">' +
            `  <p>Unknown interface identifier "${identifier}".</p>` +
            '</div>'
  }

  activateInterface(uiDefinition:REXUIDefinition):boolean {
    if (uiDefinition.identifier === 'spider') {
      $('#outstanding_issues').hide()
      $('#start_spidering').hide()
      $('#spidering_progress').hide()

      chrome.runtime.sendMessage({
        'messageType': 'checkSpidersReady'
      }).then((response) => {
        console.log('checkSpidersReady:')
        console.log(response)

        if (response['issues'].length > 0) {
          let updatedHtml = ''

          response['issues'].forEach((item, index) => { // eslint-disable-line @typescript-eslint/no-unused-vars
            updatedHtml += `<li><a href="${item.url}" target="_blank">${item.message}</li>\n`
          })

          $('#issue_list').html(updatedHtml)

          $('#outstanding_issues').show()
        } else {
          chrome.runtime.sendMessage({
            'messageType': 'checkSpidersNeedUpdate'
          }).then((needsUpdate:boolean) => {
            console.log(`[spider extension] checkSpidersNeedUpdate: ${needsUpdate}`)

            if (needsUpdate) {
              $('#start_spidering_btn').off('click')

              $('#start_spidering_btn').on('click', (eventObj) => { // eslint-disable-line @typescript-eslint/no-unused-vars
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

const spiderModule = new REXSpiderExtensionModule()

registerREXModule(spiderModule)

export default spiderModule


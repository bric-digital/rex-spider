import $ from 'jquery'

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

chrome.runtime.sendMessage({
  'messageType': 'checkSpidersReady'
}).then((response) => {
  $('#outstanding_issues').hide()
  $('#start_spidering').hide()
  $('#spidering_progress').hide()

  if (response['issues'].length > 0) {
    let updatedHtml = ''

    response['issues'].forEach((item, index) => {
      updatedHtml += `<li><a href="$%{item.url}">${item.message}</li>\n`
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

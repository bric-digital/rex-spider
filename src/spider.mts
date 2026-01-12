import $ from 'jquery'

export class WebmunkContentSpider {
  urlMatches(url:string): boolean {
    return false
  }

  fetchResults() {

  }
}

class WebmunkContentSpiderManager {
  registeredSpiders:WebmunkContentSpider[] = []

  registerSpider(spider:WebmunkContentSpider) {
    if (this.registeredSpiders.includes(spider) === false) {
      this.registeredSpiders.push(spider)
    }
  }

  unregisterSpider(spider:WebmunkContentSpider) {
    if (this.registeredSpiders.includes(spider)) {
      this.registeredSpiders = this.registeredSpiders.filter(item => item !== spider)
    }
  }

  fetchResults() {
    this.registeredSpiders.forEach((spider, index) => {
      if (spider.urlMatches(window.location.href)) {
        spider.fetchResults()
      }
    })
  }
}

const manager = new WebmunkContentSpiderManager()

// TODO: Pull out into custom jQuery library?

$.expr.pseudos.trimmedTextEquals = $.expr.createPseudo((pattern) => {
  return function(elem: Element) : boolean {
    return ($(elem).text().match("^" + pattern + "$").length > 0)
  }
})

$.expr.pseudos.containsInsensitive = $.expr.createPseudo(function (query) {
  const queryUpper = query.toUpperCase()

  return function (elem) {
    return $(elem).text().toUpperCase().includes(queryUpper)
  }
})

$(() => {
    manager.fetchResults()
})

export default manager

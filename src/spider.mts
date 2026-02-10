import $ from 'jquery'

export class REXContentSpider {

  urlMatches(url:string): boolean { // eslint-disable-line @typescript-eslint/no-unused-vars
    return false
  }

  fetchResults() {

  }

  toString():string {
    return this.name()
  }

  name():string {
    return 'REXContentSpider'
  }
}

class REXContentSpiderManager {
  registeredSpiders:REXContentSpider[] = []

  registerSpider(spider:REXContentSpider) {
    if (this.registeredSpiders.includes(spider) === false) {
      this.registeredSpiders.push(spider)
    }
  }

  unregisterSpider(spider:REXContentSpider) {
    if (this.registeredSpiders.includes(spider)) {
      this.registeredSpiders = this.registeredSpiders.filter(item => item !== spider)
    }
  }

  fetchResults() {
    this.registeredSpiders.forEach((spider, index) => { // eslint-disable-line @typescript-eslint/no-unused-vars
      if (spider.urlMatches(window.location.href)) {
        spider.fetchResults()
      }
    })
  }

  toString():string {
    return 'REXContentSpiderManager'
  }
}

const manager = new REXContentSpiderManager()

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
  console.log('[spider-page] manager.fetchResults()')

  manager.fetchResults()
})

export default manager

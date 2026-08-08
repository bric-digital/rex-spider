export interface REXSpiderConfiguration {
    enabled: boolean,
    start?: number,
    end?: number,
    time_anchor?: 'install' | 'runtime' | 'absolute'
    crawl_delay?: number
}

export interface REXSpiderModuleConfiguration {
    spiders: {
        [key:string]: REXSpiderConfiguration
    }
}

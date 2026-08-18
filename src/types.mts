export interface REXSpiderConfiguration {
    enabled: boolean,
    start?: number,
    end?: number,
    time_anchor?: 'install' | 'runtime' | 'absolute',
    crawl_delay?: number,
    sleep_delay?: number,
    halt_on_error?: boolean
}

export interface REXSpiderModuleConfiguration {
    spiders: {
        [key:string]: REXSpiderConfiguration
    }
}

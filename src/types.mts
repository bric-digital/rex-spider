export interface REXSpiderConfiguration {
    enabled: boolean,
    start?: number,
    end?: number,
    time_anchor?: 'install' | 'runtime'
}

export interface REXSpiderModuleConfiguration {
    [id:string]: REXSpiderConfiguration
}

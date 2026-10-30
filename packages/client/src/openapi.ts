// Generated from openapi.json by `pnpm --filter @pulse/client generate`. Don't edit by hand.

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Service status. `degraded` means the API runs but the database is unreachable. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Health"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description lat,lon[,radius in metres, default 1000; with layer=now 500, at most 2000] */
                    near?: string;
                    from?: string;
                    to?: string;
                    kind?: components["schemas"]["EventKind"];
                    /** @description Comma-separated; default active,upcoming */
                    status?: string;
                    /** @description now: the Right now lens. Needs `near`; returns only Events on the area or now Layer going on at this moment (time window and daily hours), noticeable ones first, then nearest first. Ignores `from` and `to`. */
                    layer?: "now";
                    /** @description Comma-separated; Events with any of them */
                    noticeable?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Events matching the query */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            events: components["schemas"]["Event"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/regions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Regions Pulse covers. Clients use them to bound address search and pick languages. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            regions: components["schemas"]["Region"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/geocode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    /** @description What the reader has typed so far */
                    text: string;
                    /** @description lat,lon: picks the Region, and nearer places rank first */
                    near: string;
                    /** @description The reader's language; the Region's main language when it doesn't speak it */
                    lang?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Places in the Region at `near` matching the text, best first. None outside every Region. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            results: components["schemas"]["GeocodeResult"][];
                        };
                    };
                };
                /** @description The geocoder failed */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                        };
                    };
                };
                /** @description The Region has no address search */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Health: {
            /** @enum {string} */
            status: "ok" | "degraded";
            /** @enum {string} */
            database: "ok" | "unreachable";
        };
        Event: {
            /** @example evt_01JB2Z8Q4M */
            id: string;
            kind: components["schemas"]["EventKind"];
            layers: components["schemas"]["Layer"][];
            title: components["schemas"]["LocalizedText"];
            originalText?: components["schemas"]["LocalizedText"] & unknown;
            where: {
                geometry: components["schemas"]["Geometry"];
                precision: components["schemas"]["Precision"];
                lines?: string[];
                stops?: string[];
            };
            when: {
                /** Format: date-time */
                start: string;
                /** Format: date-time */
                end?: string;
                dailyHours?: components["schemas"]["DailyHours"];
                endConflict?: components["schemas"]["EndConflict"];
            };
            severity: components["schemas"]["Severity"];
            mainlyAffected: components["schemas"]["MainlyAffected"];
            workType?: components["schemas"]["WorkType"];
            /** @description May be empty: nothing to sense on site */
            noticeable: components["schemas"]["Noticeable"][];
            deviation?: components["schemas"]["Deviation"];
            status: components["schemas"]["EventStatus"];
            /** @description Set when this Event shares a real-world cause with Events from other Sources */
            clusterId?: string;
            sources: components["schemas"]["EventSource"][];
            /** @description Confidence in the structured fields; 0 means not yet classified */
            confidence: number;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @enum {string} */
        EventKind: "disruption" | "works" | "closure" | "weather" | "public_event" | "anomaly";
        /** @enum {string} */
        Layer: "trips" | "area" | "now";
        /**
         * @example {
         *       "en": "Excavation · Hämeentie 12"
         *     }
         */
        LocalizedText: {
            [key: string]: string;
        };
        Geometry: {
            /** @enum {string} */
            type: "Point";
            coordinates: number[];
        } | {
            /** @enum {string} */
            type: "MultiPoint";
            coordinates: number[][];
        } | {
            /** @enum {string} */
            type: "LineString";
            coordinates: number[][];
        } | {
            /** @enum {string} */
            type: "MultiLineString";
            coordinates: number[][][];
        } | {
            /** @enum {string} */
            type: "Polygon";
            coordinates: number[][][];
        } | {
            /** @enum {string} */
            type: "MultiPolygon";
            coordinates: number[][][][];
        };
        /** @enum {string} */
        Precision: "exact" | "segment" | "area" | "vague";
        /** @description The Source's own daily hours. When absent, the Right now Layer uses defaults for the kind. */
        DailyHours: {
            /** @example 09:00 */
            from: string;
            /**
             * @description Exclusive. Earlier than `from` means past midnight.
             * @example 15:00
             */
            to: string;
            /** @description Days the hours start on; every day when absent */
            days?: components["schemas"]["Weekday"][];
        };
        /** @enum {string} */
        Weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
        /** @description The Source's text and its structured end date disagree. Either may be the stale one. */
        EndConflict: {
            /**
             * Format: date
             * @description The Source's structured end date, which `when.end` keeps
             */
            field: string;
            /**
             * Format: date
             * @description The end date the Source's own text gives
             */
            text: string;
        };
        /** @enum {string} */
        Severity: "info" | "minor" | "consider" | "major";
        /** @enum {string} */
        MainlyAffected: "drivers" | "cyclists" | "pedestrians" | "transit" | "parking" | "everyone" | "nobody" | "unknown";
        /**
         * @description Kind of work, for works Events
         * @enum {string}
         */
        WorkType: "water_sewer" | "district_heating" | "electricity_telecom" | "paving" | "street_construction" | "building_site" | "other";
        /** @enum {string} */
        Noticeable: "noise" | "crowd" | "sirens" | "blocked" | "aircraft" | "outage";
        Deviation: {
            /** @enum {string} */
            metric: "speed" | "delay" | "travel_time";
            normal: number;
            now: number;
            /** @example s */
            unit: string;
        };
        /** @enum {string} */
        EventStatus: "upcoming" | "active" | "resolved";
        EventSource: {
            /** @example City of Helsinki */
            name: string;
            /** @description The item's id at the Source */
            id: string;
            /** Format: uri */
            url?: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example CC BY 4.0 */
            license: string;
            attribution?: string;
        };
        Region: {
            /** @example fi-capital-region */
            id: string;
            name: components["schemas"]["LocalizedText"];
            /**
             * @description [minLon, minLat, maxLon, maxLat] in WGS84
             * @example [
             *       24.4,
             *       60,
             *       25.3,
             *       60.45
             *     ]
             */
            bbox: [
                number,
                number,
                number,
                number
            ];
            /**
             * @description IANA time zone
             * @example Europe/Helsinki
             */
            timeZone: string;
            /**
             * @description BCP 47 tags, the main language first
             * @example [
             *       "fi",
             *       "sv",
             *       "en"
             *     ]
             */
            languages: string[];
        };
        GeocodeResult: {
            /** @example Kamppi */
            name: string;
            /**
             * @description The name with enough around it to tell places apart
             * @example Kamppi, Kampinkuja 1, Helsinki
             */
            label: string;
            /** @example 60.169048 */
            lat: number;
            /** @example 24.931662 */
            lon: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

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
    "/trips": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    from: string;
                    to: string;
                    /** @description Comma-separated; default transit,walk,bike,car */
                    modes?: string;
                    /** @description Default: now */
                    departAt?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Each mode's itineraries, best first, with the Events on each and its Impact */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Trip"];
                    };
                };
                /** @description A and B aren't in the same Region */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                        };
                    };
                };
                /** @description Planning failed */
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
                /** @description The Region has no Trips */
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
    "/sources/health": {
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
                /** @description Each Source of each Region: when it last updated, its last error, and whether it keeps up */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            sources: components["schemas"]["SourceHealth"][];
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
    "/coverage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    near: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Layers and Sources at the point, from Region config; none outside every Region */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Coverage"];
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
        Trip: {
            /** @description Every Event on any itinerary, once */
            events: components["schemas"]["Event"][];
            plans: components["schemas"]["TripPlan"][];
            /** @description Parking around B on arrival by car: static, not whether spaces are free now */
            parking?: {
                street?: components["schemas"]["StreetParking"];
                /** @description Nearest first, within a kilometre */
                carParks: components["schemas"]["CarPark"][];
                /** @description Where the parking data comes from, to credit it */
                sources: string[];
                /** @description Where to park on arrival: the closest spot, the cheapest, and the car park with the most spaces */
                picks: components["schemas"]["ParkingPick"][];
            };
            /** @description Better today: when the fastest way has something worth considering in it, the earliest way in any mode that's less in the way and at most 10 min later */
            recommended?: {
                mode: components["schemas"]["TravelMode"];
                /** @description Into that mode's itineraries */
                index: number;
            };
        };
        TripPlan: {
            mode: components["schemas"]["TravelMode"];
            /** @description Best first; empty when there's no route */
            itineraries: components["schemas"]["Itinerary"][];
        };
        /**
         * @description car: free-flow times, without traffic
         * @enum {string}
         */
        TravelMode: "transit" | "walk" | "bike" | "car";
        Itinerary: {
            /** Format: date-time */
            start: string;
            /** Format: date-time */
            end: string;
            durationS: number;
            legs: components["schemas"]["Leg"][];
            /** @description The Events on this itinerary, from the response's `events` */
            eventIds: string[];
            /** @description Where and how each of `eventIds` is on the itinerary, in the order the trip reaches them */
            onTheWay: components["schemas"]["OnTheWay"][];
            /** @description A heads-up: what would be in this way (worth considering or major) and starts in the 7 days after it, soonest first. Its Events are in the response's `events` too */
            comingUp: (components["schemas"]["OnTheWay"] & {
                /** Format: date-time */
                startsAt: string;
            })[];
            impact: components["schemas"]["Impact"];
        };
        Leg: {
            mode: components["schemas"]["LegMode"];
            /** @description The line a transit leg rides */
            line?: {
                /** @example HSL:31M1 */
                id: string;
                /** @example M1 */
                name: string;
            };
            from: {
                /** @example Kamppi */
                name: string;
                lat: number;
                lon: number;
                /**
                 * @description The stop's id, when the place is one
                 * @example HSL:1040601
                 */
                stop?: string;
                /**
                 * @description The car park, when a car leg ends at one (park-and-ride)
                 * @example Niittykumpu
                 */
                parking?: string;
                /** @description The car park's spaces for cars, when known */
                parkingSpaces?: number;
            };
            to: {
                /** @example Kamppi */
                name: string;
                lat: number;
                lon: number;
                /**
                 * @description The stop's id, when the place is one
                 * @example HSL:1040601
                 */
                stop?: string;
                /**
                 * @description The car park, when a car leg ends at one (park-and-ride)
                 * @example Niittykumpu
                 */
                parking?: string;
                /** @description The car park's spaces for cars, when known */
                parkingSpaces?: number;
            };
            /** Format: date-time */
            start: string;
            /** Format: date-time */
            end: string;
            /** @description Ids of the stops a transit leg passes, first to last */
            stops: string[];
            /** @description Along the leg's line */
            distanceM?: number;
            geometry: {
                /** @enum {string} */
                type: "LineString";
                /** @description [lon, lat] in WGS84 */
                coordinates: [
                    number,
                    number
                ][];
            };
        };
        /** @enum {string} */
        LegMode: "walk" | "bike" | "car" | "bus" | "tram" | "rail" | "subway" | "ferry" | "other";
        OnTheWay: {
            eventId: string;
            impact: components["schemas"]["Impact"];
            /** @description Index of the first leg it's on */
            leg: number;
            /** @description [lon, lat] on the route where the trip meets it */
            at: [
                number,
                number
            ];
            /** @description Minutes from the itinerary's start to `at` */
            minutes: number;
            /** @description An area the itinerary starts and ends in: on the whole way, not one part of it */
            wholeWay?: boolean;
        };
        /**
         * @description How much this Event matters for this itinerary
         * @enum {string}
         */
        Impact: "none" | "minor" | "consider" | "major";
        StreetParking: {
            spaces: number;
            paid: number;
            /** @description Free short-term parking */
            free: number;
            /** @description For electric cars */
            ev: number;
            /** @description For disabled parking permits */
            accessible: number;
            radiusM: number;
            /** @description Each parking area's centre and what it costs on arrival, for the map */
            places: {
                lat: number;
                lon: number;
                spaces: number;
                /**
                 * @description other: only for some cars (`type`)
                 * @enum {string}
                 */
                kind: "paid" | "free" | "other";
                /** @enum {string} */
                type?: "ev" | "accessible";
                /**
                 * @description On arrival, as a pick's; absent for `other`
                 * @enum {string}
                 */
                cost?: "free" | "paid";
                perHour?: number;
                paidUntil?: string;
                freeUntil?: string;
                maxStayMin?: number;
                disc: boolean;
            }[];
        };
        CarPark: {
            /** @example Matinkylän asema */
            name: string;
            lat: number;
            lon: number;
            carSpaces: number;
            /** @description As the crow flies from the destination */
            distanceM: number;
        };
        ParkingPick: {
            /** @description Why it's picked: one spot can be several */
            reasons: ("closest" | "cheapest" | "biggest")[];
            /** @enum {string} */
            kind: "street" | "carPark";
            /** @description A car park's name */
            name?: string;
            lat: number;
            lon: number;
            /** @description As the crow flies from the destination */
            distanceM: number;
            spaces: number;
            /**
             * @description On arrival: free also when it's outside the paid hours
             * @enum {string}
             */
            cost: "free" | "paid" | "unknown";
            /** @description Euros an hour, from the fee zone, when it's paid */
            perHour?: number;
            /**
             * @description When the paid hours end on the day of arrival, as HH:MM
             * @example 21:00
             */
            paidUntil?: string;
            /**
             * @description When the paid hours begin, if it's free on arrival but not all day
             * @example 09:00
             */
            freeUntil?: string;
            maxStayMin?: number;
            /** @description A parking disc is needed */
            disc: boolean;
        };
        SourceHealth: {
            /** @example hsl-service-alerts */
            id: string;
            /** @example fi-capital-region */
            region: string;
            /** @example HSL */
            publisher: string;
            status: components["schemas"]["SourceStatus"];
            /** @description How often it's expected to update */
            refreshMinutes: number;
            /** Format: date-time */
            lastSuccessAt?: string;
            lastError?: {
                /** Format: date-time */
                at: string;
                message: string;
            };
        };
        /**
         * @description `delayed`: no successful fetch for longer than its refresh interval (or none yet); `down`: its last fetches all failed
         * @enum {string}
         */
        SourceStatus: "ok" | "delayed" | "down";
        Coverage: {
            /**
             * @description The Region's id; absent outside every Region
             * @example fi-capital-region
             */
            region?: string;
            layers: components["schemas"]["Layer"][];
            sources: {
                id: string;
                publisher: string;
                license: string;
            }[];
            /** @description What the Region has no Source for, so its absence isn't read as nothing going on */
            unavailable: {
                id: string;
                name: components["schemas"]["LocalizedText"];
                reason: components["schemas"]["LocalizedText"];
            }[];
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

'use strict';

/**
 * @ngdoc service
 * @name SolrService
 * @description 
 *  Service to broker all communication between SOLR and the UI controls
 *
 * @requires $rootScope
 * @requires $http
 * @requires LogggerService
 * @requires Configuration
 *
 */
angular.module('digiviewApp')
  .factory('SolrService', [ '$rootScope', '$http', '$routeParams', '$route', '$location', '$timeout', '$window', 'LoggerService', 'Configuration',
        function SolrService($rootScope, $http, $routeParams, $route, $location, $timeout, $window, log, conf) {
    // AngularJS will instantiate a singleton by calling "new" on this function

    var nLocationTerms = function() {
        // we need to see if there are any location bits
        var b = [];
        angular.forEach($location.search(), function(k, v) {
            b.push(k);
        });
        return b.length;
    }

    $rootScope.$on('$routeUpdate', function() {
        if (!SolrService.appInit) {
            // is the site now different to what it was? if so - do a full init
            if ($routeParams.site !== SolrService.site || nLocationTerms() > 0) {
                // purge any existing state data
                sessionStorage.removeItem('cq');

                init(SolrService.deployment, $routeParams.site);
            } else {
                // otherwise - are we just dealing with url changes
                var savedQuery = sessionStorage.getItem('cq');
                if (savedQuery !== null) {
                    initAppFromSavedData(sessionStorage.getItem('cq'));
                } else {
                    init(SolrService.deployment, $routeParams.site);
                }
            }
        }
    });

    /** 
    * @ngdoc function 
    * @name SolrService.service:init
    * @description
    *   Initialise the service. This MUST be called prior to the service being used. Probably
    *   from an init method when a search form is loaded (this is likely the first time the 
    *   service will be required).
    * @param {string} deployment - The SOLR deployment to target: testing || production
    * @param {string} site - The SOLR core to target; e.g. FACP
    * @returns {boolean} true or false to tell you all is well or not. Use this to figure out
    *   if the app should be disabled.
    * @example
    *   // initialise the service and ensure we stop if it's broken<br/>
    *   scope.good_to_go = SolrService.init(scope.deployment, scope.site);
    *
    */
    function init() {
        log.init(conf.loglevel);
        log.info('############');
        log.info('############ APPLICATION INITIALISED');
        log.info('############');
        SolrService.filters = {};
        SolrService.dateFilters = {};
        SolrService.results = {};
        SolrService.facets = {};

        SolrService.deployment = conf[conf.deployment];
        SolrService.site = conf.site;
        SolrService.searchType = conf.searchType;
        SolrService.solr = SolrService.deployment + '/' + SolrService.site + '/select';
        log.debug('Solr Service: ' + SolrService.solr);
        log.debug('Site: ' + SolrService.site);

        // url search parameters override saved queries
        if (nLocationTerms() > 0) {
            sessionStorage.removeItem('cq');
        } 

        // if the site changes - ditch the stored data
        var savedQuery = SolrService.loadData()
        if (savedQuery !== undefined && savedQuery.site !== SolrService.site) {
            sessionStorage.removeItem('cq');
        }
        
        // if a saved query exists - get it
        var savedQuery = SolrService.loadData();
        if (savedQuery !== undefined) {
            initAppFromSavedData();
        } else {
            // init the app
            initCurrentInstance();
        }

        // Broadcast ready to go
        SolrService.appInit = false;
        $timeout(function() {
            $rootScope.$broadcast('app-ready');
        }, 1000);

        return true;
    }

    /*
     * @ngdoc function
     * @name loadData
     */
    function loadData() {
        var d = sessionStorage.getItem('cq');
        return angular.fromJson($rootScope.$eval(d));
    }

    /**
     * @ngdoc function
     * @name initAppFromSavedData
     */
    function initAppFromSavedData() {
        var data = SolrService.loadData();
        SolrService.appInit = true;
        log.info('Initialising app from saved data');
        SolrService.q = data.q;
        SolrService.filters = data.filters,
        SolrService.dateFilters = data.dateFilters,
        SolrService.term = data.term;
        SolrService.searchType = data.searchType;
        SolrService.sort = data.sort;
        SolrService.start = data.start;
    }

    /**
     * @ngdoc function
     * @name initCurrentInstance
     */
    function initCurrentInstance() {
        SolrService.appInit = true;
        log.info('Bootstrapping app');
        var params = $location.search();

        // if there's a term in the URL - set it
        if (params.q !== undefined) {
            SolrService.term = params.q;
        } else {
            SolrService.term = '*';
        }

        // set the various facets defined in the URI
        angular.forEach(params, function(v,k) {
            if (k !== 'q') {
                if (typeof(v) === 'object') {
                    for (var i=0; i < v.length ; i++) {
                        SolrService.filterQuery(k, v[i], true);
                    }
                } else {
                    SolrService.filterQuery(k, v, true);
                }
            }
        });

        $location.search({}).replace();
    }

    /**
     * @ngdoc function
     * @name getQuery
     * @description
     *  Construct the actual query object - the workhorse
     */
    function getQuery(start, groupId, what) {
        var q, sort;

        var sf = what === undefined ? SolrService.term : what;

        if (SolrService.searchType === 'keyword') {
            sf = sf.replace(/ /gi, ' ' + conf.keywordSearchOperator + ' ');
            q = 'title:(' + sf + ')^20 OR text:(' + sf + ')^10';
        } else {
            q = 'title:"' + sf + '"^20 OR text:"' + sf + '"^10';
        }

        if (groupId !== undefined) {
            q += ' AND group:' + groupId;
        }

        // add in the facet query filters - if any...
        var fq = getFilterObject().join(' AND ');
        if (fq === undefined) {
            fq = '';
        }

        // set the sort order: wildcard sort ascending, everything else: by score
        SolrService.resultSort = 'score desc';

        q = {
            'url': SolrService.solr,
            'params': {
                'q': q,
                'start': start,
                'rows': SolrService.rows,
                'wt': 'json',
                'json.wrf': 'JSON_CALLBACK',
                'fq': fq,
                'group': true,
                'group.field': 'group',
                'group.sort': 'page asc',
                'group.ngroups': true,
                'hl': 'true',
                'hl.simple.pre': '<em>',
                'hl.simple.post': '</em>'
            },
        }

        if (groupId !== undefined) {
            q.params['group.limit'] = -1;
        }

        SolrService.q = q;
        return SolrService.q;
    }

    /**
     * @ngdoc function
     * @name saveCurrentSearch
     * @description
     *  Save the current search to the browser's session storage
     */
    function saveCurrentSearch() {
        // store the current query 
        var currentQuery = {
            'date': Date.now(),
            'term': SolrService.term,
            'q': getQuery(0),
            'filters': SolrService.filters,
            'dateFilters': SolrService.dateFilters,
            'searchType': SolrService.searchType,
            'sort': SolrService.sort,
            'site': SolrService.site,
            'start': SolrService.start
        }
        sessionStorage.setItem('cq', angular.toJson(currentQuery));
    }

    /**
     * @ngdoc function
     * @name SolrService.service:search
     * @description
     *  The workhorse function.
     *
     *  Perform a simple phrase search on the name and text fields. If no results are found,
     *  there are no filters in play and the term is a single word, the search is automatically re-run as 
     *  a fuzzy search and a spell check is requested as well.
     *
     * @param {string} what - The thing to search for. Multiple words get treated
     *  as a phrase.
     * @param {string} start - The result to start at. 
     * @param {boolean} ditchuggestion - Whether to delete the spelling 
     *  suggestion.
     */
    function search(start, groupId) {
        // what are we starting at?
        if (start === undefined) { 
            start = 0;
        }

        // if we're in the viewer and a search term is specified
        //  we need to trigger a second search to get the page matches
        if ($location.path().match(/\/view\//) && SolrService.term !== '*') {
            var q = getQuery(start, groupId, '*');
            $http.jsonp(SolrService.solr, q).then(function(d) {
                // all good - results found
                saveData(d);

                // trigger a second search to get the matches
                var q1 = getQuery(start, groupId);
                $http.jsonp(SolrService.solr, q1).then(function(d) {
                    SolrService.matches = d.data.highlighting;
                    $rootScope.$broadcast('matches-available');
                });
            });

        } else {
            // get the query object
            var q = getQuery(start, groupId);
            log.debug('query: ');
            log.debug(q);
            
            $http.jsonp(SolrService.solr, q).then(function(d) {
                // all good - results found
                saveData(d);

                SolrService.matches === undefined;
            });
        }
    }

    /**
     * @ngdoc function
     * @name SolrService.service:saveData
     * @description
     *  Pass it a SOLR response and it manages the data object used by the interface.
     *  
     *  This method knows how to handle no result found as well as new data via infinite scroll.
     *  
     *  The message 'search-results-updated' is broadcast via $rootScope when the data is ready
     *   to go. Any widget that interacts with the data should listen for this message.
     * @param {object} d - The SOLR response
     */
    function saveData(d) {
        if (d === undefined) {
            SolrService.results = {
                'term': SolrService.term,
                'total': 0,
                'items': []
            };
        } else {
            var items = [];
            
            angular.forEach(d.data.grouped.group.groups, function(v, k) {
                items.push(v.doclist);
            });

            SolrService.results = {
                'term': SolrService.term,
                'totalGroups': d.data.grouped.group.ngroups,
                'totalMatches': d.data.grouped.group.matches,
                'start': parseInt(d.data.responseHeader.params.start),
                'items': items,
                'highlighting': d.data.highlighting
            };

            angular.forEach(SolrService.results.items, function(v,k) {
                SolrService.results.items[k].sequenceNo = SolrService.start + k + 1;
            });
        }
        
        // update all facet counts
        updateAllFacetCounts();
        saveCurrentSearch();

        // notify the result widget that it's time to update
        $rootScope.$broadcast('search-results-updated');
    }


    /**
     * @ngdoc function
     * @name SolrService.service:previousPage
     * @description
     *  Get the next set of results.
     */
    function previousPage() {
        var start = SolrService.start - SolrService.rows;
        SolrService.start = start;
        if (start < 0 || SolrService.start < 0) {
            SolrService.start = 0;
            start = 0;
        }
        search(start);
    }

    /**
     * @ngdoc function
     * @name SolrService.service:nextPage
     * @description
     *  Get the next set of results.
     */
    function nextPage() {
        var start = SolrService.start + SolrService.rows;
        SolrService.start = start;
        search(start);
    }

    /**
     * @ngdoc function
     * @name SolrService.service:updateFacetCount
     * @description
     *  Trigger a facet search returning a promise for use by the caller.
     * @param {string} facet - The field to facet on
     */
    function updateFacetCount(facet, offset, limit) {
        if (offset === undefined) {
            offset = 0;
        }
        if (limit === undefined) {
            limit = 10;
        }

        var q = getQuery(0);
        q.params.facet = true;
        q.params['facet.field'] = facet;
        q.params['facet.limit'] = limit;
        q.params['facet.sort'] = 'count';
        q.params['facet.offset'] = offset;
        q.params.rows = 0;
        //log.debug(q);
        $http.jsonp(SolrService.solr, q).then(function(d) {
            angular.forEach(d.data.facet_counts.facet_fields, function(v, k) {
                var f = [];
                for (var i = 0; i < v.length; i += 2) {
                    f.push([ v[i], v[i+1], false ]);
                }
                SolrService.facets[k] = f;
                $rootScope.$broadcast(k+'-facets-updated');
            });
        });
    }

    /*
     * @ngdoc function
     * @name SolrService.service:updateAllFacetCounts
     * @description
     *  Iterate over the facets and update them all relative to the 
     *  current context.
     */
    function updateAllFacetCounts() {
        // now trigger an update of all facet counts
        angular.forEach(SolrService.facets, function(v, k) {
            SolrService.updateFacetCount(k);
        });
        $rootScope.$broadcast('update-date-facets');
    }

    /**
     * @ngdoc function
     * @name SolrService.service:filterQuery
     * @description
     *  Add or remove a facet from the filter query object and trigger
     *  a search.
     * @param {string} facetField - The facet's field name
     * @param {string} facet - the value
     * @param {string} dontSearch - optional value to disable the search part
     */
    function filterQuery(facetField, facet, dontSearch) {
        // iterate over the facets and 
        //  - add it if it's not there 
        //  - remove it if it is
        //
        // initially - the object will be empty
        if (SolrService.filters[facetField] === undefined) {
            SolrService.filters[facetField] = [ facet ];
        } else {
            // not on subsequent runs / events
            if (SolrService.filters[facetField].indexOf(facet) === -1) {
                SolrService.filters[facetField].push(facet);
            } else {
                var idxof = SolrService.filters[facetField].indexOf(facet);
                SolrService.filters[facetField].splice(idxof, 1);
                if (SolrService.filters[facetField].length === 0) {
                    delete SolrService.filters[facetField];
                }
            }
        }

        if (dontSearch !== true) {
            SolrService.results.docs = [];
            SolrService.results.start = 0;
            search(0);
        }
    }

    /**
     * @ngdoc function
     * @name SolrService.service:filterDateQuery
     * @description
     *  Add or remove a date facet from the filter query object and trigger
     *  a search.
     * @param {string} facet
     */
    function filterDateQuery(facetField, existenceFromField, existenceToField, facetLabel) {
        var facetLowerBound, facetUpperBound, df, marker;
        facetLowerBound = facetLabel.split(' - ')[0];
        facetUpperBound = facetLabel.split(' - ')[1];
        if (existenceFromField !== undefined && existenceToField !== undefined) {
            marker = existenceFromField + '-' + existenceToField + '-' + facetLabel.replace(' - ', '_');
        } else {
            marker = facetField + '-' + facetLabel.replace(' - ', '_');
        }

        if (! SolrService.dateFilters[marker]) {
            df = {
                'from': facetLowerBound + '-01-01T00:00:00Z',
                'to': facetUpperBound + '-12-31T23:59:59Z',
                'facetField': facetField,
                'label': facetLabel,
                'existenceFromField': existenceFromField,
                'existenceToField': existenceToField,
            };
            SolrService.dateFilters[marker] = df;
        } else {
            delete SolrService.dateFilters[marker];
        }

        SolrService.results.docs = [];
        SolrService.results.start = 0;
        search(0);
    }

    /**
     * @ngdoc function
     * @name SolrService.service:getFilterObject
     * @description
     *  Return an array of filter queries
     * @returns {array} An array of filter queries
     */
    function getFilterObject() {
        var fq = [];
        var f;
        
        // add in the named filters
        for (f in SolrService.filters) {
            var j = SolrService.filterUnion[f];
            fq.push(f + ':("' + SolrService.filters[f].join('" ' + j + ' "') + '")');
        }

        // add in the date range filters
        var dfq = [];
        for (f in SolrService.dateFilters) {
            var v = SolrService.dateFilters[f];
            if (v.existenceFromField !== undefined && v.existenceToField !== undefined) {
                var query;
                var query = '(exist_from:[' + conf.datasetStart + ' TO ' + v.to + ']';
                query += ' AND ';
                query += 'exist_to:[' + v.from + ' TO ' + conf.datasetEnd + '])';
                dfq.push(query);
            } else {
                var query = v.facetField + ':[' + v.from + ' TO ' + v.to + ']';
                dfq.push(query);
            }

        }

        if (fq.length > 0 && dfq.length > 0) {
            fq = fq.concat([ '(' + dfq.join(' OR ') + ')' ]);
        } else if (dfq.length > 0) {
            fq = [ '(' + dfq.join(' OR ') + ')' ];
        }
        return fq;
    }

    /**
     * @ngdoc function
     * @name SolrService.service:clearAllFilters
     * @description
     *   Removes all filters
     */
    function clearAllFilters() {
        SolrService.filters = {};
        SolrService.dateFilters = {};
        
        // update the search
        search(0);

        // tell all the filters to reset
        $rootScope.$broadcast('reset-all-filters');
    }

    /*
     * @ngdoc function
     * @name SolrService.service:clearFilter
     */
    function clearFilter(facet) {
        delete SolrService.filters[facet];
        
        // update the search
        search(0);
    }

    /**
     * @ngdoc function
     * @name SolrService.service:toggleDetails
     * @description
     *   Toggle's detail view
     */
    function toggleDetails() {
        SolrService.hideDetails = !SolrService.hideDetails;
        if (SolrService.hideDetails === true) {
            $rootScope.$broadcast('hide-search-results-details');
        } else {
            $rootScope.$broadcast('show-search-results-details');
        }
    }

    /**
     * @ngdoc function
     * @name SolrService.service:reSort
     * @description
     *  Re-sort the result set - this triggers a re-search with
     *  the updated sort order.
     */
    function reSort() {
        search(0);
    }

    /**
     * @ngdoc function
     * @name SolrService.service:dateOuterBounds
     * @description
     *  Will determine the outer date bounds of the current context
     *   and store them within the object
     */
    function dateOuterBounds() {
        var q = {
            'url': SolrService.solr,
            'params': {
                'q': '*:*',
                'start': 0,
                'rows': 1,
                'wt': 'json',
                'json.wrf': 'JSON_CALLBACK',
                'sort': 'exist_from asc'
            }
        };
        $http.jsonp(SolrService.solr, q).then(function(d) {
            SolrService.dateStartBoundary = d.data.response.docs[0].exist_from;
            var q = {
                'url': SolrService.solr,
                'params': {
                    'q': '*:*',
                    'start': 0,
                    'rows': 1,
                    'wt': 'json',
                    'json.wrf': 'JSON_CALLBACK',
                    'sort': 'exist_from desc'
                }
            };
            $http.jsonp(SolrService.solr, q).then(function(d) {
                SolrService.dateEndBoundary = d.data.response.docs[0].exist_to;
                SolrService.compileDateFacets();
            });
        });
    }

    function compileDateFacets(facetField, id, start, end, interval) {
        $rootScope.$broadcast('reset-date-facets');

        var a, b;
        a = getQuery(0);
        a.params.rows = 0;
        a.params.facet = true;
        a.params['facet.range'] = facetField;
        a.params['facet.range.start'] = start + '-01-01T00:00:00Z';
        a.params['facet.range.end'] = end + '-12-31T23:59:59Z';
        a.params['facet.range.gap'] = '+' + interval + 'YEARS';

        $http.jsonp(SolrService.solr, a).then(function(d) {
            var counts = d.data.facet_counts.facet_ranges[facetField].counts;
            var i, df;
            df = [];
            var thisYear = new Date().getFullYear();
            for (i=0; i < counts.length; i+=2) {
                var rangeEnd = parseInt(counts[i].split('-')[0]) + parseInt(interval) - 1;
                if (rangeEnd > end) {
                    rangeEnd = end;
                }
                if (rangeEnd > thisYear) {
                    rangeEnd = thisYear;
                }
                df.push({
                    'rangeStart': parseInt(counts[i].split('-')[0]), 
                    'rangeEnd': rangeEnd,
                    'count': counts[i+1]
                });
            }
            var marker = facetField + '_' + id;
            SolrService.dateFacets[marker] = df; 
            $rootScope.$broadcast(marker + '-facet-data-ready');
        });

    }


    var SolrService = {
        results: {},
        facets: {},
        dateFacets: {},
        filters: {},
        filterUnion: {},
        dateFilters: {},
        searchWhat: [],
        term: '*',
        rows: 10,
        start: 0,
        sort: undefined,
        resultSort: undefined,
        hideDetails: false,

        init: init,
        loadData: loadData,
        search: search,
        saveData: saveData,
        previousPage: previousPage,
        nextPage: nextPage,
        updateFacetCount: updateFacetCount,
        filterQuery: filterQuery,
        getFilterObject: getFilterObject,
        filterDateQuery: filterDateQuery,
        clearFilter: clearFilter,
        clearAllFilters: clearAllFilters,
        toggleDetails: toggleDetails,
        reSort: reSort,
        dateOuterBounds: dateOuterBounds,
        compileDateFacets: compileDateFacets,
    };
    return SolrService;
  }]);

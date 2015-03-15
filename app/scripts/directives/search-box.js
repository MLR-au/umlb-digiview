'use strict';

angular.module('digiviewApp')
  .directive('searchBox', [ 'SolrService', function (SolrService) {
    return {
      templateUrl: 'views/search-box.html',
      restrict: 'E',
      scope: {
          help: '@',
          searchType: '@'
      },
      link: function postLink(scope, element, attrs) {
          // handle the app being bootstrapped
          scope.$on('app-ready', function() {
              scope.searchBox = SolrService.term;
              SolrService.search();
          });

          scope.setSearchBox = function() {
              scope.searchBox = '*';
          }

          scope.search = function() {
              // args:
              // - what: scope.searchBox (the search term
              // - start: 0 (record to start at)
              // - ditchSuggestion: true
              SolrService.term = scope.searchBox;
              SolrService.search();
          };

          // let's get this party started!!
          scope.setSearchBox();
          scope.ready = SolrService.init();

      },
    };
  }]);

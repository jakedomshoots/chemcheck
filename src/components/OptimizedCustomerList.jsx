import React, { useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, Users, Clock } from 'lucide-react';
import { useOptimizedFilter, usePagination, useMemoryMonitor } from '@/lib/performance';
import { useCustomers } from '@/api/convexHooks';

export function OptimizedCustomerList({ 
  onCustomerSelect, 
  showPagination = true,
  pageSize = 50,
  enableVirtualScroll = false 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');

  // Get customers data
  const customers = useCustomers();
  const memoryInfo = useMemoryMonitor();

  // Optimized filtering and sorting
  const filteredCustomers = useOptimizedFilter(
    customers,
    searchTerm,
    (customer, term) => {
      const searchLower = term.toLowerCase();
      return (
        customer.full_name?.toLowerCase().includes(searchLower) ||
        customer.address?.toLowerCase().includes(searchLower) ||
        customer.email?.toLowerCase().includes(searchLower) ||
        customer.phone?.includes(term)
      );
    },
    (a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'name':
          aValue = a.full_name || '';
          bValue = b.full_name || '';
          break;
        case 'service_day':
          aValue = a.service_day || '';
          bValue = b.service_day || '';
          break;
        case 'sort_order':
          aValue = a.sort_order || 999;
          bValue = b.sort_order || 999;
          break;
        default:
          return 0;
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    }
  );

  // Pagination
  const {
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    paginatedData,
    goToPage,
    nextPage,
    prevPage,
    totalItems
  } = usePagination(filteredCustomers, pageSize);

  // Display data (paginated or all)
  const displayData = showPagination ? paginatedData : filteredCustomers;

  // Performance warning
  const showPerformanceWarning = useMemo(() => {
    return customers.length > 1000 || (memoryInfo && memoryInfo.percentage > 70);
  }, [customers.length, memoryInfo]);

  const handleSortChange = (newSortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('asc');
    }
  };

  return (
    <div className="space-y-4">
      {/* Performance Warning */}
      {showPerformanceWarning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-yellow-800">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">Performance Notice</span>
          </div>
          <p className="text-sm text-yellow-700 mt-1">
            {customers.length > 1000 && `Large dataset (${customers.length} customers) - consider using filters.`}
            {memoryInfo && memoryInfo.percentage > 70 && ` High memory usage (${memoryInfo.percentage.toFixed(1)}%).`}
          </p>
        </div>
      )}

      {/* Search and Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search customers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="name">Sort by Name</option>
            <option value="service_day">Sort by Service Day</option>
            <option value="sort_order">Sort by Order</option>
          </select>

          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-blue-500"
            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span>
            Showing {displayData.length} of {totalItems} customers
            {searchTerm && ` (filtered from ${customers.length})`}
          </span>
        </div>
        
        {showPagination && totalPages > 1 && (
          <span>
            Page {currentPage} of {totalPages}
          </span>
        )}
      </div>

      {/* Customer List */}
      <div className="space-y-2">
        {displayData.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? 'No customers match your search.' : 'No customers found.'}
          </div>
        ) : (
          displayData.map((customer) => (
            <CustomerCard
              key={customer.id || customer._id}
              customer={customer}
              onClick={() => onCustomerSelect?.(customer)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={prevPage}
            disabled={!hasPrevPage}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => goToPage(pageNum)}
                  className={`px-3 py-1 rounded ${
                    currentPage === pageNum
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={nextPage}
            disabled={!hasNextPage}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// Memoized customer card component for better performance
const CustomerCard = React.memo(({ customer, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">{customer.full_name}</h3>
          <p className="text-sm text-gray-600 mt-1">{customer.address}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span>Service: {customer.service_day}</span>
            <span>Pool: {customer.pool_type}</span>
            {customer.pool_gallons && <span>{customer.pool_gallons.toLocaleString()} gal</span>}
          </div>
        </div>
        
        {customer.phone && (
          <div className="text-sm text-gray-600">
            {customer.phone}
          </div>
        )}
      </div>
    </div>
  );
});

CustomerCard.displayName = 'CustomerCard';
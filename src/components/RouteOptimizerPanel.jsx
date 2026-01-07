import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  Route, 
  Clock, 
  Navigation, 
  Settings, 
  Play,
  Save,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Car
} from 'lucide-react';
import { routeOptimizer } from '@/lib/routeOptimizer';
import { useCustomers } from '@/api/convexHooks';

export function RouteOptimizerPanel({ selectedDate, onRouteGenerated }) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [options, setOptions] = useState({
    algorithm: 'nearest-neighbor',
    startTime: '08:00',
    maxWorkingHours: 8,
    prioritizeTimeWindows: true,
    prioritizeHighPriority: true,
    avoidTraffic: false
  });
  const [showSettings, setShowSettings] = useState(false);

  const customers = useCustomers();

  useEffect(() => {
    // Load existing route for the selected date
    const existingRoute = routeOptimizer.getRouteForDate(selectedDate);
    if (existingRoute) {
      setOptimizedRoute(existingRoute);
    } else {
      setOptimizedRoute(null);
    }
  }, [selectedDate]);

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
      const route = await routeOptimizer.optimizeRoute(customers, selectedDate, options);
      setOptimizedRoute(route);
      onRouteGenerated?.(route);
    } catch (error) {
      console.error('Route optimization failed:', error);
      alert('Route optimization failed: ' + error.message);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleSaveRoute = () => {
    if (optimizedRoute) {
      routeOptimizer.saveRoute(optimizedRoute);
      alert('Route saved successfully!');
    }
  };

  const handleExportRoute = () => {
    if (!optimizedRoute) return;

    const exportData = {
      date: optimizedRoute.date,
      totalStops: optimizedRoute.stops.length,
      totalDistance: optimizedRoute.totalDistance.toFixed(1),
      totalTime: Math.round(optimizedRoute.totalTime),
      stops: optimizedRoute.stops.map((stop, index) => ({
        order: index + 1,
        customer: stop.customer.name,
        address: stop.customer.address,
        arrivalTime: stop.arrivalTime,
        departureTime: stop.departureTime,
        serviceTime: stop.customer.estimatedDuration,
        notes: stop.customer.notes || ''
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `route-${selectedDate}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const getDayCustomers = () => {
    const dayOfWeek = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
    return customers.filter(c => c.service_day === dayOfWeek);
  };

  const dayCustomers = getDayCustomers();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <Route className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Route Optimizer</h2>
            <p className="text-sm text-gray-500">
              {new Date(selectedDate).toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-4">Optimization Settings</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Algorithm
              </label>
              <select
                value={options.algorithm}
                onChange={(e) => setOptions(prev => ({ ...prev, algorithm: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="nearest-neighbor">Nearest Neighbor (Fast)</option>
                <option value="genetic">Genetic Algorithm (Better)</option>
                <option value="simulated-annealing">Simulated Annealing (Best)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Time
              </label>
              <input
                type="time"
                value={options.startTime}
                onChange={(e) => setOptions(prev => ({ ...prev, startTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Working Hours
              </label>
              <input
                type="number"
                min="1"
                max="12"
                value={options.maxWorkingHours}
                onChange={(e) => setOptions(prev => ({ ...prev, maxWorkingHours: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.prioritizeTimeWindows}
                  onChange={(e) => setOptions(prev => ({ ...prev, prioritizeTimeWindows: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Prioritize Time Windows</span>
              </label>
              
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.prioritizeHighPriority}
                  onChange={(e) => setOptions(prev => ({ ...prev, prioritizeHighPriority: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Prioritize High Priority Customers</span>
              </label>
              
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.avoidTraffic}
                  onChange={(e) => setOptions(prev => ({ ...prev, avoidTraffic: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Avoid Traffic (Coming Soon)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Customer Summary */}
      <div className="mb-6">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            <span>{dayCustomers.length} customers scheduled</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>
              {dayCustomers.reduce((total, c) => total + (c.estimatedDuration || 30), 0)} min estimated
            </span>
          </div>
        </div>
      </div>

      {/* Optimization Button */}
      <div className="mb-6">
        <button
          onClick={handleOptimize}
          disabled={isOptimizing || dayCustomers.length === 0}
          className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isOptimizing ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              Optimizing Route...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Optimize Route
            </>
          )}
        </button>
      </div>

      {/* Route Results */}
      {optimizedRoute && (
        <div className="space-y-4">
          {/* Route Summary */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="font-medium text-green-900">Route Optimized</span>
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-green-600 font-medium">Total Distance</div>
                <div className="text-green-900">{optimizedRoute.totalDistance.toFixed(1)} miles</div>
              </div>
              <div>
                <div className="text-green-600 font-medium">Total Time</div>
                <div className="text-green-900">{formatTime(optimizedRoute.totalTime)}</div>
              </div>
              <div>
                <div className="text-green-600 font-medium">Stops</div>
                <div className="text-green-900">{optimizedRoute.stops.length}</div>
              </div>
            </div>
          </div>

          {/* Route Stops */}
          <div className="space-y-2">
            <h4 className="font-medium text-gray-900">Route Stops</h4>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {optimizedRoute.stops.map((stop, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {stop.customer.name}
                    </div>
                    <div className="text-sm text-gray-500 truncate">
                      {stop.customer.address}
                    </div>
                  </div>
                  
                  <div className="text-right text-sm">
                    <div className="text-gray-900 font-medium">{stop.arrivalTime}</div>
                    <div className="text-gray-500">
                      {stop.travelTime > 0 && `${Math.round(stop.travelTime)}m travel`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleSaveRoute}
              className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Route
            </button>
            
            <button
              onClick={handleExportRoute}
              className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      )}

      {/* No Customers Message */}
      {dayCustomers.length === 0 && (
        <div className="text-center py-8">
          <Car className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Customers Scheduled</h3>
          <p className="text-gray-500">
            No customers are scheduled for service on this day.
          </p>
        </div>
      )}
    </div>
  );
}
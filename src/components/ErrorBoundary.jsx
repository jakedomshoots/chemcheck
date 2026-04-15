import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportError } from '@/lib/sentry';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { 
            hasError: false, 
            error: null, 
            errorInfo: null,
            errorId: null 
        };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // Generate unique error ID for tracking
        const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Log error securely (only in development or to secure logging service)
        const isDev = import.meta.env.DEV;
        if (isDev) {
            console.error(`[${errorId}] Uncaught error:`, error, errorInfo);
        } else {
            // In production, log minimal info
            console.error(`[${errorId}] Application error occurred`);
        }
        
        // Send to Sentry
        reportError(error, { errorId, errorInfo });
        
        this.setState({ 
            error, 
            errorInfo, 
            errorId 
        });
    }



    handleReload = () => {
        window.location.reload();
    }

    handleReset = () => {
        this.setState({ 
            hasError: false, 
            error: null, 
            errorInfo: null, 
            errorId: null 
        });
    }

    render() {
        if (this.state.hasError) {
            const isDev = import.meta.env.DEV;
            
            return (
                <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-6 text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle className="w-8 h-8 text-red-600" />
                        </div>
                        
                        <h1 className="text-xl font-bold text-gray-900 mb-2">
                            Oops! Something went wrong
                        </h1>
                        
                        <p className="text-gray-600 mb-6">
                            We're sorry, but something unexpected happened. Your data is safe and stored locally.
                        </p>
                        
                        {this.state.errorId && (
                            <p className="text-xs text-gray-500 mb-4 font-mono bg-gray-100 p-2 rounded">
                                Error ID: {this.state.errorId}
                            </p>
                        )}
                        
                        <div className="space-y-3">
                            <button
                                onClick={this.handleReset}
                                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                Try Again
                            </button>
                            
                            <button
                                onClick={this.handleReload}
                                className="w-full bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Reload App
                            </button>
                        </div>
                        
                        {isDev && this.state.error && (
                            <details className="mt-6 text-left">
                                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                                    Developer Info (Dev Mode Only)
                                </summary>
                                <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto max-h-40">
                                    {this.state.error.toString()}
                                    {this.state.errorInfo && this.state.errorInfo.componentStack}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

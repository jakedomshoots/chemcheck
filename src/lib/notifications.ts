// Push Notification System
// Handles service reminders and alerts for pool service management

import { monitoring } from './monitoring';
import { userManager } from './userManager';

export interface NotificationConfig {
  enabled: boolean;
  serviceReminders: boolean;
  lowChemicals: boolean;
  customerUpdates: boolean;
  reminderTime: string; // HH:MM format
  advanceNotice: number; // hours before service
}

export interface ScheduledNotification {
  id: string;
  type: 'service-reminder' | 'low-chemical' | 'customer-update' | 'route-ready';
  title: string;
  body: string;
  scheduledFor: string; // ISO timestamp
  data?: any;
  sent: boolean;
}

class NotificationManager {
  private permission: NotificationPermission = 'default';
  private config: NotificationConfig;
  private scheduledNotifications: ScheduledNotification[] = [];
  private checkInterval: number | null = null;

  constructor() {
    this.config = this.loadConfig();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permission = Notification.permission;
    } else {
      this.permission = 'denied';
    }
    this.loadScheduledNotifications();
    this.startNotificationChecker();
  }

  // ============================================
  // Permission Management
  // ============================================

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }

    if (this.permission === 'granted') {
      return true;
    }

    try {
      this.permission = await Notification.requestPermission();
      
      monitoring.recordMetric('notification_permission_requested', performance.now(), {
        result: this.permission
      });

      return this.permission === 'granted';
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  }

  hasPermission(): boolean {
    return this.permission === 'granted';
  }

  // ============================================
  // Configuration
  // ============================================

  updateConfig(newConfig: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem('notification_config', JSON.stringify(this.config));
    
    // Update user preferences
    const user = userManager.getCurrentUser();
    if (user) {
      userManager.updateUserPreferences({
        notifications: {
          serviceReminders: this.config.serviceReminders,
          lowChemicals: this.config.lowChemicals,
          customerUpdates: this.config.customerUpdates
        }
      });
    }
  }

  getConfig(): NotificationConfig {
    return this.config;
  }

  // ============================================
  // Immediate Notifications
  // ============================================

  async showNotification(
    title: string,
    body: string,
    options: {
      icon?: string;
      badge?: string;
      tag?: string;
      data?: any;
      actions?: Array<{ action: string; title: string; icon?: string }>;
      requireInteraction?: boolean;
    } = {}
  ): Promise<boolean> {
    if (!this.config.enabled || !this.hasPermission()) {
      return false;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: options.icon || '/icon-192.png',
        badge: options.badge || '/icon-192.png',
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction || false,
        ...options
      });

      // Handle notification click
      notification.onclick = (event) => {
        event.preventDefault();
        window.focus();
        
        // Handle specific notification types
        if (options.data?.type === 'service-reminder' && options.data?.customerId) {
          // Navigate to customer detail or service log
          window.location.hash = `#/CustomerDetail?id=${options.data.customerId}`;
        } else if (options.data?.type === 'route-ready') {
          // Navigate to route optimizer
          window.location.hash = '#/RouteOptimizer';
        }
        
        notification.close();
      };

      monitoring.recordMetric('notification_shown', performance.now(), {
        type: options.data?.type || 'manual',
        tag: options.tag
      });

      return true;
    } catch (error) {
      console.error('Failed to show notification:', error);
      monitoring.reportError({
        message: 'Failed to show notification',
        severity: 'low',
        metadata: { title, error: error instanceof Error ? error.message : 'Unknown error' }
      });
      return false;
    }
  }

  // ============================================
  // Scheduled Notifications
  // ============================================

  scheduleNotification(notification: Omit<ScheduledNotification, 'id' | 'sent'>): string {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const scheduledNotification: ScheduledNotification = {
      ...notification,
      id,
      sent: false
    };

    this.scheduledNotifications.push(scheduledNotification);
    this.saveScheduledNotifications();

    monitoring.recordMetric('notification_scheduled', performance.now(), {
      type: notification.type,
      scheduledFor: notification.scheduledFor
    });

    return id;
  }

  cancelNotification(id: string): boolean {
    const index = this.scheduledNotifications.findIndex(n => n.id === id);
    if (index >= 0) {
      this.scheduledNotifications.splice(index, 1);
      this.saveScheduledNotifications();
      return true;
    }
    return false;
  }

  getScheduledNotifications(): ScheduledNotification[] {
    return this.scheduledNotifications.filter(n => !n.sent);
  }

  // ============================================
  // Service Reminder Notifications
  // ============================================

  scheduleServiceReminders(customers: any[], date: string): void {
    if (!this.config.serviceReminders) return;

    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
    const dayCustomers = customers.filter(c => c.service_day === dayOfWeek);

    for (const customer of dayCustomers) {
      const reminderTime = new Date(date);
      const [hours, minutes] = this.config.reminderTime.split(':').map(Number);
      reminderTime.setHours(hours - this.config.advanceNotice, minutes, 0, 0);

      // Only schedule if the reminder time is in the future
      if (reminderTime.getTime() > Date.now()) {
        this.scheduleNotification({
          type: 'service-reminder',
          title: 'Service Reminder',
          body: `Upcoming service for ${customer.full_name} at ${customer.address}`,
          scheduledFor: reminderTime.toISOString(),
          data: {
            customerId: customer.id || customer._id,
            customerName: customer.full_name,
            address: customer.address
          }
        });
      }
    }
  }

  scheduleRouteReadyNotification(date: string, routeData: any): void {
    const notificationTime = new Date(date);
    notificationTime.setHours(7, 0, 0, 0); // 7 AM on service day

    if (notificationTime.getTime() > Date.now()) {
      this.scheduleNotification({
        type: 'route-ready',
        title: 'Route Ready',
        body: `Your optimized route for today is ready with ${routeData.stops?.length || 0} stops`,
        scheduledFor: notificationTime.toISOString(),
        data: {
          date,
          totalStops: routeData.stops?.length || 0,
          totalDistance: routeData.totalDistance,
          totalTime: routeData.totalTime
        }
      });
    }
  }

  scheduleLowChemicalAlert(chemicalType: string, currentLevel: number, threshold: number): void {
    if (!this.config.lowChemicals) return;

    // Don't spam - only alert once per day per chemical
    const today = new Date().toDateString();
    const existingAlert = this.scheduledNotifications.find(n => 
      n.type === 'low-chemical' && 
      n.data?.chemicalType === chemicalType &&
      new Date(n.scheduledFor).toDateString() === today
    );

    if (existingAlert) return;

    this.scheduleNotification({
      type: 'low-chemical',
      title: 'Low Chemical Alert',
      body: `${chemicalType} is running low (${currentLevel}/${threshold} remaining)`,
      scheduledFor: new Date().toISOString(), // Immediate
      data: {
        chemicalType,
        currentLevel,
        threshold
      }
    });
  }

  // ============================================
  // Notification Checker
  // ============================================

  private startNotificationChecker(): void {
    // Check every minute for due notifications
    this.checkInterval = window.setInterval(() => {
      this.checkDueNotifications();
    }, 60000);
  }

  private async checkDueNotifications(): Promise<void> {
    const now = Date.now();
    const dueNotifications = this.scheduledNotifications.filter(
      n => !n.sent && new Date(n.scheduledFor).getTime() <= now
    );

    for (const notification of dueNotifications) {
      await this.sendScheduledNotification(notification);
    }

    // Clean up old sent notifications (older than 7 days)
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    this.scheduledNotifications = this.scheduledNotifications.filter(
      n => !n.sent || new Date(n.scheduledFor).getTime() > weekAgo
    );

    this.saveScheduledNotifications();
  }

  private async sendScheduledNotification(notification: ScheduledNotification): Promise<void> {
    const success = await this.showNotification(
      notification.title,
      notification.body,
      {
        tag: notification.id,
        data: { ...notification.data, type: notification.type },
        requireInteraction: notification.type === 'service-reminder'
      }
    );

    if (success) {
      notification.sent = true;
      
      monitoring.recordMetric('scheduled_notification_sent', performance.now(), {
        type: notification.type,
        scheduledFor: notification.scheduledFor
      });
    }
  }

  // ============================================
  // Data Persistence
  // ============================================

  private loadConfig(): NotificationConfig {
    try {
      const stored = localStorage.getItem('notification_config');
      if (stored) {
        return { ...this.getDefaultConfig(), ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Failed to load notification config:', error);
    }
    return this.getDefaultConfig();
  }

  private getDefaultConfig(): NotificationConfig {
    return {
      enabled: true,
      serviceReminders: true,
      lowChemicals: true,
      customerUpdates: true,
      reminderTime: '08:00',
      advanceNotice: 1 // 1 hour before
    };
  }

  private loadScheduledNotifications(): void {
    try {
      const stored = localStorage.getItem('scheduled_notifications');
      if (stored) {
        this.scheduledNotifications = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load scheduled notifications:', error);
      this.scheduledNotifications = [];
    }
  }

  private saveScheduledNotifications(): void {
    try {
      localStorage.setItem('scheduled_notifications', JSON.stringify(this.scheduledNotifications));
    } catch (error) {
      console.error('Failed to save scheduled notifications:', error);
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// Global notification manager
export const notificationManager = new NotificationManager();

// Convenience functions
export const requestNotificationPermission = () => notificationManager.requestPermission();
export const showNotification = (title: string, body: string, options?: any) => 
  notificationManager.showNotification(title, body, options);
export const scheduleServiceReminders = (customers: any[], date: string) => 
  notificationManager.scheduleServiceReminders(customers, date);
export const scheduleRouteReadyNotification = (date: string, routeData: any) => 
  notificationManager.scheduleRouteReadyNotification(date, routeData);

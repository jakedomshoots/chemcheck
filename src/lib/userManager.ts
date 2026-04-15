// User Management System
// Handles multiple users while maintaining offline-first architecture

import { db } from '@/db/chemcheck-db';
import { monitoring } from './monitoring';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'employee' | 'admin';
  businessId: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  language: string;
  timezone: string;
  notifications: {
    serviceReminders: boolean;
    lowChemicals: boolean;
    customerUpdates: boolean;
  };
  defaultView: 'route' | 'customers' | 'calendar';
  autoBackup: boolean;
  default_workorders_section?: 'dispatch' | 'quotes' | 'invoices' | 'comms';
  home_primary_action?: 'start_next_pending' | 'open_route_plan' | 'add_client';
  show_ops_brief?: boolean;
}

export interface Business {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  ownerId: string;
  settings: BusinessSettings;
  createdAt: string;
}

export interface BusinessSettings {
  workingDays: string[];
  workingHours: {
    start: string;
    end: string;
  };
  serviceTypes: string[];
  chemicalTypes: string[];
  defaultPoolTypes: string[];
  defaultSurfaceTypes: string[];
  routeOptimization: boolean;
  requirePhotos: boolean;
  requireSignatures: boolean;
  defaultWorkordersSection?: 'dispatch' | 'quotes' | 'invoices' | 'comms';
  homePrimaryAction?: 'start_next_pending' | 'open_route_plan' | 'add_client';
  showOpsBrief?: boolean;
}

class UserManager {
  private currentUser: User | null = null;
  private currentBusiness: Business | null = null;

  constructor() {
    this.loadCurrentUser();
  }

  // ============================================
  // User Authentication & Management
  // ============================================

  async createUser(userData: Omit<User, 'id' | 'createdAt' | 'isActive'>): Promise<User> {
    const user: User = {
      ...userData,
      id: this.generateUserId(),
      isActive: true,
      createdAt: new Date().toISOString(),
      preferences: this.getDefaultPreferences()
    };

    // Store user data locally
    const users = this.getStoredUsers();
    users.push(user);
    localStorage.setItem('chemcheck_users', JSON.stringify(users));

    monitoring.recordMetric('user_created', performance.now(), {
      role: user.role,
      businessId: user.businessId
    });

    return user;
  }

  async loginUser(email: string, businessId?: string): Promise<User | null> {
    const users = this.getStoredUsers();
    const user = users.find(u =>
      u.email === email &&
      u.isActive &&
      (!businessId || u.businessId === businessId)
    );

    if (user) {
      user.lastLoginAt = new Date().toISOString();
      this.setCurrentUser(user);

      monitoring.recordMetric('user_login', performance.now(), {
        userId: user.id,
        role: user.role
      });

      return user;
    }

    return null;
  }

  async switchUser(userId: string): Promise<boolean> {
    const users = this.getStoredUsers();
    const user = users.find(u => u.id === userId && u.isActive);

    if (user) {
      this.setCurrentUser(user);
      return true;
    }

    return false;
  }

  logoutUser(): void {
    this.currentUser = null;
    this.currentBusiness = null;

    // Clear all sensitive ChemCheck data from localStorage
    const keysToRemove = [
      'chemcheck_current_user',
      'chemcheck_current_business',
      'chemcheck_users',
      'chemcheck_businesses',
      'chemcheck_sync_state',
      'chemcheck_sync_queue',
      'chemcheck_last_sync',
      'chemcheck_backup_credentials',
    ];

    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Also clear any rate limit keys
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(key => {
      if (key.startsWith('rateLimit_') || key.startsWith('chemcheck_')) {
        localStorage.removeItem(key);
      }
    });

    monitoring.recordMetric('user_logout', performance.now());
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  isLoggedIn(): boolean {
    return this.currentUser !== null;
  }

  // ============================================
  // Business Management
  // ============================================

  async createBusiness(businessData: Omit<Business, 'id' | 'createdAt'>): Promise<Business> {
    const business: Business = {
      ...businessData,
      id: this.generateBusinessId(),
      createdAt: new Date().toISOString(),
      settings: this.getDefaultBusinessSettings()
    };

    // Store business data locally
    const businesses = this.getStoredBusinesses();
    businesses.push(business);
    localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));

    this.setCurrentBusiness(business);

    monitoring.recordMetric('business_created', performance.now(), {
      businessId: business.id,
      ownerId: business.ownerId
    });

    return business;
  }

  getCurrentBusiness(): Business | null {
    return this.currentBusiness;
  }

  async updateBusinessSettings(settings: Partial<BusinessSettings>): Promise<void> {
    if (!this.currentBusiness) throw new Error('No active business');

    this.currentBusiness.settings = {
      ...this.currentBusiness.settings,
      ...settings
    };

    const businesses = this.getStoredBusinesses();
    const index = businesses.findIndex(b => b.id === this.currentBusiness!.id);
    if (index >= 0) {
      businesses[index] = this.currentBusiness;
      localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));
    }
  }

  async updateBusinessOwner(businessId: string, ownerId: string): Promise<Business | null> {
    const businesses = this.getStoredBusinesses();
    const businessIndex = businesses.findIndex(b => b.id === businessId);

    if (businessIndex === -1) {
      throw new Error(`Business with id ${businessId} not found`);
    }

    const business = businesses[businessIndex];

    // Security: Only current owner, admin, or the user being assigned can change ownership
    // This allows the initial setup flow where a new user assigns themselves as owner
    const isInitialOwnerAssignment = !business.ownerId || business.ownerId === '';
    const isCurrentUserTheNewOwner = this.currentUser?.id === ownerId;
    const isCurrentUserTheExistingOwner = this.currentUser?.id === business.ownerId;
    const hasAdminPermission = this.hasPermission('business.changeOwner');

    if (!isInitialOwnerAssignment && !isCurrentUserTheNewOwner && !isCurrentUserTheExistingOwner && !hasAdminPermission) {
      throw new Error('Insufficient permissions to change business ownership');
    }

    // Validate that the new owner exists and is active
    const users = this.getStoredUsers();
    const owner = users.find(u => u.id === ownerId && u.isActive);
    if (!owner) {
      throw new Error(`User with id ${ownerId} not found or inactive`);
    }

    // Update business in storage
    businesses[businessIndex].ownerId = ownerId;
    localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));

    // Update current business if it's the one being modified
    if (this.currentBusiness?.id === businessId) {
      this.currentBusiness.ownerId = ownerId;
      localStorage.setItem('chemcheck_current_business', JSON.stringify(this.currentBusiness));
    }

    // Record monitoring metric
    monitoring.recordMetric('business_owner_updated', performance.now(), {
      businessId,
      newOwnerId: ownerId,
      updatedBy: this.currentUser?.id
    });

    return businesses[businessIndex];
  }

  // ============================================
  // Data Isolation & Multi-tenancy
  // ============================================

  getDataPrefix(): string {
    if (!this.currentUser || !this.currentBusiness) {
      return 'local'; // Fallback for single-user mode
    }
    return `${this.currentBusiness.id}_${this.currentUser.id}`;
  }

  async isolateUserData(): Promise<void> {
    // This would be called when switching users to ensure data isolation
    // For now, we'll use the existing DEFAULT_USER approach but make it dynamic
    const prefix = this.getDataPrefix();

    // Update the database queries to use the prefix
    // This is a placeholder for future implementation
    console.log(`Data isolated for: ${prefix}`);
  }

  // ============================================
  // User Preferences
  // ============================================

  async updateUserPreferences(preferences: Partial<UserPreferences>): Promise<void> {
    if (!this.currentUser) throw new Error('No active user');

    this.currentUser.preferences = {
      ...this.currentUser.preferences,
      ...preferences
    };

    const users = this.getStoredUsers();
    const index = users.findIndex(u => u.id === this.currentUser!.id);
    if (index >= 0) {
      users[index] = this.currentUser;
      localStorage.setItem('chemcheck_users', JSON.stringify(users));
    }
  }

  getUserPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
    return this.currentUser?.preferences[key] || this.getDefaultPreferences()[key];
  }

  // ============================================
  // Role-Based Access Control
  // ============================================

  hasPermission(action: string): boolean {
    if (!this.currentUser) return false;

    const permissions = this.getRolePermissions(this.currentUser.role);
    return permissions.includes(action) || permissions.includes('*');
  }

  private getRolePermissions(role: User['role']): string[] {
    const permissionMap = {
      owner: ['*'], // Full access
      admin: [
        'customers.create', 'customers.read', 'customers.update', 'customers.delete',
        'serviceLogs.create', 'serviceLogs.read', 'serviceLogs.update', 'serviceLogs.delete',
        'notes.create', 'notes.read', 'notes.update', 'notes.delete',
        'chemicals.create', 'chemicals.read', 'chemicals.update', 'chemicals.delete',
        'reports.read', 'reports.export',
        'users.read', 'users.update',
        'business.read', 'business.update', 'business.changeOwner'
      ],
      employee: [
        'customers.read',
        'serviceLogs.create', 'serviceLogs.read', 'serviceLogs.update',
        'notes.create', 'notes.read', 'notes.update',
        'chemicals.create', 'chemicals.read', 'chemicals.update',
        'reports.read'
      ]
    };

    return permissionMap[role] || [];
  }

  // ============================================
  // Helper Methods
  // ============================================

  private loadCurrentUser(): void {
    try {
      const userData = localStorage.getItem('chemcheck_current_user');
      const businessData = localStorage.getItem('chemcheck_current_business');

      if (userData) {
        this.currentUser = JSON.parse(userData);
      }

      if (businessData) {
        this.currentBusiness = JSON.parse(businessData);
      }
    } catch (error) {
      console.error('Failed to load current user:', error);
    }
  }

  private setCurrentUser(user: User): void {
    this.currentUser = user;
    localStorage.setItem('chemcheck_current_user', JSON.stringify(user));

    // Load associated business
    const businesses = this.getStoredBusinesses();
    const business = businesses.find(b => b.id === user.businessId);
    if (business) {
      this.setCurrentBusiness(business);
    }
  }

  private setCurrentBusiness(business: Business): void {
    this.currentBusiness = business;
    localStorage.setItem('chemcheck_current_business', JSON.stringify(business));
  }

  private getStoredUsers(): User[] {
    try {
      const data = localStorage.getItem('chemcheck_users');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private getStoredBusinesses(): Business[] {
    try {
      const data = localStorage.getItem('chemcheck_businesses');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private generateUserId(): string {
    return `user_${crypto.randomUUID()}`;
  }

  private generateBusinessId(): string {
    return `biz_${crypto.randomUUID()}`;
  }

  private getDefaultPreferences(): UserPreferences {
    return {
      language: 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      notifications: {
        serviceReminders: true,
        lowChemicals: true,
        customerUpdates: true
      },
      defaultView: 'route',
      autoBackup: true,
      default_workorders_section: 'dispatch',
      home_primary_action: 'start_next_pending',
      show_ops_brief: true,
    };
  }

  private getDefaultBusinessSettings(): BusinessSettings {
    return {
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      workingHours: {
        start: '08:00',
        end: '17:00'
      },
      serviceTypes: ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'],
      chemicalTypes: ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down', 'Alkalinity Up', 'Stabilizer'],
      defaultPoolTypes: ['Chlorine', 'Salt'],
      defaultSurfaceTypes: ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'],
      routeOptimization: true,
      requirePhotos: false,
      requireSignatures: false,
      defaultWorkordersSection: 'dispatch',
      homePrimaryAction: 'start_next_pending',
      showOpsBrief: true,
    };
  }

  // ============================================
  // Migration & Setup
  // ============================================

  async setupSingleUserBusiness(): Promise<{ user: User; business: Business }> {
    // For existing single-user installations, create a default business and user
    const businessId = this.generateBusinessId();

    const business = await this.createBusiness({
      name: 'My Pool Service',
      address: '',
      phone: '',
      email: '',
      ownerId: '', // Will be set after user creation
      settings: this.getDefaultBusinessSettings()
    });

    const user = await this.createUser({
      email: 'owner@local',
      name: 'Business Owner',
      role: 'owner',
      businessId: business.id,
      preferences: this.getDefaultPreferences()
    });

    // Update business owner
    business.ownerId = user.id;
    const businesses = this.getStoredBusinesses();
    const index = businesses.findIndex(b => b.id === business.id);
    if (index >= 0) {
      businesses[index] = business;
      localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));
    }

    await this.loginUser(user.email, business.id);

    return { user, business };
  }

  async bootstrapFromConvex(convexBusiness: any, userEmail: string): Promise<{ user: User; business: Business }> {
    try {
      // 1. Create a local representation of the business with null-safe settings access
      let business: Business = {
        id: convexBusiness._id,
        name: convexBusiness.name,
        address: convexBusiness.address || '',
        phone: convexBusiness.phone || '',
        email: convexBusiness.email || userEmail,
        ownerId: 'placeholder', // Will be updated below
        settings: {
          workingDays: convexBusiness.settings?.working_days || this.getDefaultBusinessSettings().workingDays,
          workingHours: {
            start: convexBusiness.settings?.working_hours_start || '08:00',
            end: convexBusiness.settings?.working_hours_end || '17:00'
          },
          serviceTypes: convexBusiness.settings?.service_types || this.getDefaultBusinessSettings().serviceTypes,
          chemicalTypes: convexBusiness.settings?.chemical_types || this.getDefaultBusinessSettings().chemicalTypes,
          defaultPoolTypes: this.getDefaultBusinessSettings().defaultPoolTypes,
          defaultSurfaceTypes: this.getDefaultBusinessSettings().defaultSurfaceTypes,
          routeOptimization: convexBusiness.settings?.route_optimization ?? true,
          requirePhotos: convexBusiness.settings?.require_photos ?? false,
          requireSignatures: convexBusiness.settings?.require_signatures ?? false,
          defaultWorkordersSection: convexBusiness.settings?.default_workorders_section || 'dispatch',
          homePrimaryAction: convexBusiness.settings?.home_primary_action || 'start_next_pending',
          showOpsBrief: convexBusiness.settings?.show_ops_brief ?? true,
        },
        createdAt: new Date(convexBusiness.created_at || Date.now()).toISOString()
      };

      // 2. Create a local representation of the user
      // Generate a stable ID based on business and email to prevent collisions
      // simple hash of email to keep it relatively short but unique per email
      const emailHash = btoa(userEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      let user: User = {
        id: `user_${convexBusiness._id}_${emailHash}`,
        email: userEmail,
        name: convexBusiness.name ? `${convexBusiness.name} Owner` : 'Business Owner',
        role: 'owner',
        businessId: business.id,
        isActive: true,
        createdAt: business.createdAt,
        preferences: this.getDefaultPreferences()
      };

      // 3. Store in localStorage, using existing data if present for consistency
      const users = this.getStoredUsers();
      // Check by email OR ID to avoid duplicates if ID gen strategy changed
      const existingUser = users.find(u => u.email === userEmail || u.id === user.id);

      if (!existingUser) {
        users.push(user);
        localStorage.setItem('chemcheck_users', JSON.stringify(users));
      } else {
        // Use the existing user from storage for consistency
        user = existingUser;
      }

      // Set owner after user resolution to ensure consistency
      business.ownerId = user.id;

      const businesses = this.getStoredBusinesses();
      const existingBusiness = businesses.find(b => b.id === business.id);
      if (!existingBusiness) {
        businesses.push(business);
        localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));
      } else {
        // Use the existing business from storage for consistency
        business = existingBusiness;
      }

      // 4. Set as current
      this.setCurrentUser(user);
      this.setCurrentBusiness(business);

      // Record monitoring metric
      monitoring.recordMetric('bootstrap_from_convex', performance.now(), {
        userId: user.id,
        businessId: business.id
      });

      return { user, business };
    } catch (error) {
      console.error('Failed to bootstrap from Convex:', error);
      monitoring.recordMetric('bootstrap_from_convex_failed', performance.now(), {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to bootstrap user and business from Convex data');
    }
  }

  isFirstTimeSetup(): boolean {
    const users = this.getStoredUsers();
    const businesses = this.getStoredBusinesses();
    return users.length === 0 && businesses.length === 0;
  }
}

// Global user manager instance
export const userManager = new UserManager();

// Convenience functions
export const getCurrentUser = () => userManager.getCurrentUser();
export const getCurrentBusiness = () => userManager.getCurrentBusiness();
export const hasPermission = (action: string) => userManager.hasPermission(action);
export const getUserPreference = <K extends keyof UserPreferences>(key: K) =>
  userManager.getUserPreference(key);

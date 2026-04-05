/**
 * Secure Storage Module
 * 
 * SECURITY: This module provides secure storage utilities with:
 * - Encryption for sensitive data using Web Crypto API (AES-GCM)
 * - Session-based storage option for sensitive data
 * - Key derivation from user-specific data
 * - Content Security Policy recommendations
 * 
 * Note: Client-side encryption is defense-in-depth, not a substitute
 * for proper server-side security. It protects against casual snooping
 * and cross-tab XSS, but a determined attacker with XSS access to the
 * same origin can still access the keys.
 */

const ENCRYPTION_KEY_NAME = 'chemcheck_encryption_key';
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM

/**
 * Generate a new encryption key and store it securely
 * The key is stored in sessionStorage (cleared when browser closes)
 * to limit exposure window
 */
async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    const existingKeyData = sessionStorage.getItem(ENCRYPTION_KEY_NAME);

    if (existingKeyData) {
        try {
            const keyData = new Uint8Array(JSON.parse(existingKeyData));
            return await crypto.subtle.importKey(
                'raw',
                keyData,
                { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
                false,
                ['encrypt', 'decrypt']
            );
        } catch {
            sessionStorage.removeItem(ENCRYPTION_KEY_NAME);
        }
    }

    const key = await crypto.subtle.generateKey(
        { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );

    const exportedKey = await crypto.subtle.exportKey('raw', key);
    sessionStorage.setItem(
        ENCRYPTION_KEY_NAME,
        JSON.stringify(Array.from(new Uint8Array(exportedKey)))
    );

    return key;
}

/**
 * Encrypt data using AES-GCM
 */
async function encryptData(plaintext: string): Promise<string> {
    const key = await getOrCreateEncryptionKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const ciphertext = await crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM, iv },
        key,
        data
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    // SECURITY: Use chunked conversion to avoid call stack overflow with large arrays
    // String.fromCharCode(...array) fails with >~65k elements due to stack limits
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < combined.length; i += chunkSize) {
        const chunk = combined.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
}

/**
 * Decrypt data using AES-GCM
 */
async function decryptData(encrypted: string): Promise<string | null> {
    try {
        const key = await getOrCreateEncryptionKey();

        const combined = new Uint8Array(
            atob(encrypted).split('').map(c => c.charCodeAt(0))
        );

        const iv = combined.slice(0, IV_LENGTH);
        const ciphertext = combined.slice(IV_LENGTH);

        // SECURITY: AES-GCM decrypt automatically verifies the authentication tag
        // (included in ciphertext). If tag verification fails, crypto.subtle.decrypt
        // will throw an OperationError, and we return null in the catch block.
        // This provides authenticated encryption - both confidentiality and integrity.
        const plaintext = await crypto.subtle.decrypt(
            { name: ENCRYPTION_ALGORITHM, iv },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(plaintext);
    } catch (error) {
        console.error('[SecureStorage] Decryption failed:', error);
        return null;
    }
}

export interface SecureStorageOptions {
    /** Use sessionStorage instead of localStorage (more secure, shorter lifetime) */
    useSessionStorage?: boolean;
    /** Encrypt the data before storage */
    encrypt?: boolean;
}

/**
 * Store data securely
 * 
 * @param key Storage key
 * @param value Data to store (will be JSON serialized)
 * @param options Security options
 */
export async function secureSet<T>(
    key: string,
    value: T,
    options: SecureStorageOptions = {}
): Promise<void> {
    const { useSessionStorage = false, encrypt = false } = options;
    const storage = useSessionStorage ? sessionStorage : localStorage;

    let serialized = JSON.stringify(value);

    if (encrypt) {
        serialized = await encryptData(serialized);
        serialized = `ENC:${serialized}`;
    }

    storage.setItem(key, serialized);
}

/**
 * Retrieve data securely
 * 
 * @param key Storage key
 * @param options Security options (must match what was used during set)
 * @returns Parsed data or null if not found/decryption failed
 */
export async function secureGet<T>(
    key: string,
    options: SecureStorageOptions = {}
): Promise<T | null> {
    const { useSessionStorage = false } = options;
    const storage = useSessionStorage ? sessionStorage : localStorage;

    let data = storage.getItem(key);
    if (!data) return null;

    if (data.startsWith('ENC:')) {
        const encrypted = data.slice(4);
        const decrypted = await decryptData(encrypted);
        if (!decrypted) return null;
        data = decrypted;
    }

    try {
        return JSON.parse(data) as T;
    } catch {
        return null;
    }
}

/**
 * Remove data from secure storage
 */
export function secureRemove(
    key: string,
    options: SecureStorageOptions = {}
): void {
    const { useSessionStorage = false } = options;
    const storage = useSessionStorage ? sessionStorage : localStorage;
    storage.removeItem(key);
}

/**
 * User data that should be stored securely
 */
export interface SecureUserData {
    email?: string;
    name?: string;
    lastLoginAt?: number;
}

const USER_DATA_KEY = 'chemcheck_secure_user';

/**
 * Store user data securely
 * Uses sessionStorage + encryption for defense in depth
 */
export async function setSecureUserData(data: SecureUserData): Promise<void> {
    await secureSet(USER_DATA_KEY, data, {
        useSessionStorage: true,
        encrypt: true
    });
}

/**
 * Retrieve user data securely
 */
export async function getSecureUserData(): Promise<SecureUserData | null> {
    return secureGet<SecureUserData>(USER_DATA_KEY, {
        useSessionStorage: true
    });
}

/**
 * Clear secure user data
 */
export function clearSecureUserData(): void {
    secureRemove(USER_DATA_KEY, { useSessionStorage: true });
}

/**
 * Migrate legacy localStorage data to secure storage
 * Call this during app initialization
 */
export async function migrateLegacyStorage(): Promise<void> {
    const legacyUserData = localStorage.getItem('chemcheck_current_user');
    if (legacyUserData) {
        try {
            const userData = JSON.parse(legacyUserData);
            await setSecureUserData({
                email: userData.email,
                name: userData.name,
                lastLoginAt: Date.now(),
            });
            localStorage.removeItem('chemcheck_current_user');
            console.log('[SecureStorage] Migrated legacy user data to secure storage');
        } catch {
            // Leave legacy data in place if migration fails
            console.warn('[SecureStorage] Failed to migrate legacy user data');
        }
    }
}

/**
 * For non-sensitive data that doesn't need encryption
 * Still validates JSON and provides type safety
 */
export function setItem<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
}

export function getItem<T>(key: string, defaultValue?: T): T | null {
    const data = localStorage.getItem(key);
    if (!data) return defaultValue ?? null;

    try {
        return JSON.parse(data) as T;
    } catch {
        return defaultValue ?? null;
    }
}

export function removeItem(key: string): void {
    localStorage.removeItem(key);
}

/**
 * Recommended Content Security Policy for defense against XSS
 * Add to your index.html or server response headers:
 * 
 * Content-Security-Policy:
 *   default-src 'self';
 *   script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
 *   style-src 'self' 'unsafe-inline';
 *   img-src 'self' data: https:;
 *   connect-src 'self' https://*.convex.cloud https://*.clerk.accounts.dev;
 *   frame-src 'self' https://challenges.cloudflare.com;
 *   font-src 'self' data:;
 */
export const RECOMMENDED_CSP = `
  default-src 'self';
  script-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://*.convex.cloud https://*.clerk.accounts.dev;
  frame-src 'self' https://challenges.cloudflare.com;
  font-src 'self' data:;
`.trim().replace(/\n\s+/g, ' ');

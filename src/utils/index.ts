


export function createPageUrl(pageName: string) {
    return '/' + pageName.toLowerCase().replace(/ /g, '-');
}

/**
 * Parse a YYYY-MM-DD date string as a local date (not UTC)
 * This avoids timezone issues where "2025-12-17" becomes Dec 16 in US timezones
 * when using new Date("2025-12-17") which interprets it as UTC midnight.
 * 
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object in local timezone, or null if invalid
 */
export function parseLocalDate(dateString: string): Date | null {
    if (!dateString || typeof dateString !== 'string') return null;
    const parts = dateString.split('-');
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    
    // Validate ranges
    if (year < 1 || year > 9999) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    
    // Construct date and verify it matches input (catches invalid days for month)
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    
    return date;
}

export function formatServiceDate(dateString: string): string {
    // Split the date string to avoid timezone conversion
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month, 10) - 1]} ${parseInt(day, 10)}`;
}

export function formatServiceDateFull(dateString: string): string {
    // Split the date string to avoid timezone conversion
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
}
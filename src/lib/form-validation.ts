/**
 * Real-time form validation helpers
 * Provides instant feedback as users type
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate email format in real-time
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim().length === 0) {
    return { isValid: false, error: "Email is required" };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: "Please enter a valid email (e.g., you@example.com)" };
  }
  
  return { isValid: true };
}

/**
 * Validate password strength in real-time
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || password.trim().length === 0) {
    return { isValid: false, error: "Password is required" };
  }
  
  if (password.length < 8) {
    return { isValid: false, error: "Password must be at least 8 characters" };
  }
  
  // Optional: Add strength requirements
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  if (!hasUpperCase || !hasLowerCase || !hasNumber) {
    return { 
      isValid: true, // Still valid, but show suggestion
      error: "For better security: use uppercase, lowercase, and numbers" 
    };
  }
  
  return { isValid: true };
}

/**
 * Validate password confirmation
 */
export function validatePasswordConfirmation(
  password: string, 
  confirmation: string
): ValidationResult {
  if (!confirmation || confirmation.trim().length === 0) {
    return { isValid: false, error: "Please confirm your password" };
  }
  
  if (password !== confirmation) {
    return { isValid: false, error: "Passwords don't match" };
  }
  
  return { isValid: true };
}

/**
 * Validate required text field
 */
export function validateRequired(
  value: string, 
  fieldName: string
): ValidationResult {
  if (!value || value.trim().length === 0) {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  return { isValid: true };
}

/**
 * Validate URL format
 */
export function validateURL(url: string): ValidationResult {
  if (!url || url.trim().length === 0) {
    return { isValid: false, error: "URL is required" };
  }
  
  try {
    new URL(url);
    return { isValid: true };
  } catch {
    return { isValid: false, error: "Please enter a valid URL (e.g., https://example.com)" };
  }
}

/**
 * Validate minimum length
 */
export function validateMinLength(
  value: string, 
  minLength: number,
  fieldName: string
): ValidationResult {
  if (!value || value.trim().length === 0) {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  if (value.length < minLength) {
    return { 
      isValid: false, 
      error: `${fieldName} must be at least ${minLength} characters` 
    };
  }
  
  return { isValid: true };
}

/**
 * Validate maximum length
 */
export function validateMaxLength(
  value: string, 
  maxLength: number,
  fieldName: string
): ValidationResult {
  if (value.length > maxLength) {
    return { 
      isValid: false, 
      error: `${fieldName} must be less than ${maxLength} characters` 
    };
  }
  
  return { isValid: true };
}

/**
 * Password strength indicator (0-4)
 */
export function getPasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  
  const levels = [
    { label: "Very Weak", color: "#EF4444" },
    { label: "Weak", color: "#F59E0B" },
    { label: "Fair", color: "#F59E0B" },
    { label: "Good", color: "#10B981" },
    { label: "Strong", color: "#10B981" },
  ];
  
  return { score, ...levels[score] };
}

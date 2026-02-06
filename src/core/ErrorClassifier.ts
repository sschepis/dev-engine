// =============================================================================
// OpenClaw DevEngine - Error Classification System
// =============================================================================

import { IErrorClassifier, ClassifiedError, ErrorCategory } from '../interfaces/index.js';

/**
 * Patterns for identifying different error categories
 */
interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  extractInfo?: (match: RegExpExecArray, stderr: string) => Partial<ClassifiedError>;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: 'syntax',
    patterns: [
      /SyntaxError:\s*(.+)/i,
      /Unexpected token/i,
      /Parsing error/i,
      /error TS1\d{3}:/,  // TypeScript syntax errors are 1xxx
    ],
    extractInfo: (match) => ({
      suggestion: 'Check for missing brackets, semicolons, or invalid syntax'
    })
  },
  {
    category: 'type',
    patterns: [
      /TypeError:\s*(.+)/i,
      /error TS2\d{3}:/,  // TypeScript type errors are 2xxx
      /Type '(.+)' is not assignable to type '(.+)'/,
      /Property '(.+)' does not exist on type/,
      /Cannot find name '(.+)'/,
    ],
    extractInfo: (match) => ({
      suggestion: 'Review type definitions and ensure type compatibility'
    })
  },
  {
    category: 'import',
    patterns: [
      /Cannot find module '(.+)'/,
      /Module not found/i,
      /Error \[ERR_MODULE_NOT_FOUND\]/,
      /Unable to resolve module/i,
      /No such file or directory.*import/i,
    ],
    extractInfo: (match) => ({
      suggestion: `Check if the module exists and is correctly installed: ${match[1] || 'unknown'}`
    })
  },
  {
    category: 'runtime',
    patterns: [
      /ReferenceError:\s*(.+)/i,
      /RangeError:\s*(.+)/i,
      /Error:\s*(.+) is not defined/i,
      /Maximum call stack size exceeded/i,
      /undefined is not a function/i,
      /null is not an object/i,
    ],
    extractInfo: (match) => ({
      suggestion: 'Check for undefined variables, null references, or infinite recursion'
    })
  },
  {
    category: 'assertion',
    patterns: [
      /expect\(.+\)\.(not\.)?to(Be|Equal|Have|Match|Throw)/,
      /AssertionError/i,
      /Expected:?\s*.+\s*Received:?\s*.+/i,
      /expected .+ to (equal|be|match|throw)/i,
      /FAIL\s+.+\.test\.(ts|js)/,
    ],
    extractInfo: (match, stderr) => {
      const expectedMatch = /Expected:?\s*(.+)/i.exec(stderr);
      const receivedMatch = /Received:?\s*(.+)/i.exec(stderr);
      return {
        expected: expectedMatch?.[1]?.trim(),
        actual: receivedMatch?.[1]?.trim(),
        suggestion: 'The implementation does not match expected behavior'
      };
    }
  },
  {
    category: 'timeout',
    patterns: [
      /Timeout/i,
      /exceeded timeout/i,
      /ETIMEDOUT/i,
      /Async callback was not invoked within/i,
      /Test timeout of \d+ms exceeded/i,
    ],
    extractInfo: () => ({
      suggestion: 'Consider increasing timeout or optimizing async operations'
    })
  },
  {
    category: 'permission',
    patterns: [
      /EACCES/,
      /Permission denied/i,
      /EPERM/,
      /Operation not permitted/i,
    ],
    extractInfo: () => ({
      suggestion: 'Check file permissions and ensure write access'
    })
  },
  {
    category: 'resource',
    patterns: [
      /ENOENT/,
      /No such file or directory/i,
      /ENOTDIR/,
      /File not found/i,
      /Directory not found/i,
    ],
    extractInfo: (match, stderr) => {
      const pathMatch = /ENOENT.*'(.+)'/.exec(stderr);
      return {
        suggestion: `Ensure the path exists: ${pathMatch?.[1] || 'unknown path'}`
      };
    }
  },
  {
    category: 'network',
    patterns: [
      /ECONNREFUSED/,
      /ENOTFOUND/,
      /getaddrinfo/,
      /network error/i,
      /socket hang up/i,
      /ECONNRESET/,
    ],
    extractInfo: () => ({
      suggestion: 'Check network connectivity and service availability'
    })
  }
];

/**
 * Extract file location from error output
 */
function extractLocation(stderr: string): { file?: string; line?: number; column?: number } {
  // Common patterns for file:line:column
  const patterns = [
    /at\s+.+\((.+):(\d+):(\d+)\)/,           // Stack trace format
    /(.+\.(?:ts|js)):(\d+):(\d+)/,            // file.ts:10:5
    /(.+\.(?:ts|js))\((\d+),(\d+)\)/,         // file.ts(10,5)
    /error TS\d+: (.+\.ts):(\d+):(\d+)/,      // TypeScript error
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(stderr);
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      };
    }
  }

  return {};
}

/**
 * Extract the most relevant error message from stderr
 */
function extractMessage(stderr: string): string {
  const lines = stderr.split('\n').filter(l => l.trim());
  
  // Look for common error message patterns
  for (const line of lines) {
    if (line.includes('Error:') || 
        line.includes('FAIL') ||
        line.includes('error TS')) {
      return line.trim();
    }
  }

  // Fall back to first non-empty line
  return lines[0]?.trim() || 'Unknown error';
}

/**
 * Classifies errors from command output into categories for targeted fixes
 */
export class ErrorClassifier implements IErrorClassifier {
  private fixStrategies: Map<ErrorCategory, string> = new Map();

  constructor() {
    this.initializeFixStrategies();
  }

  /**
   * Classify an error based on stderr output and exit code
   */
  classify(stderr: string, exitCode: number): ClassifiedError {
    const normalizedStderr = stderr.toLowerCase();
    const location = extractLocation(stderr);
    const message = extractMessage(stderr);

    // Try to match against known patterns
    for (const errorPattern of ERROR_PATTERNS) {
      for (const pattern of errorPattern.patterns) {
        const match = pattern.exec(stderr) || pattern.exec(normalizedStderr);
        if (match) {
          const additionalInfo = errorPattern.extractInfo?.(match, stderr) || {};
          return {
            category: errorPattern.category,
            message,
            ...location,
            ...additionalInfo,
            originalError: stderr
          };
        }
      }
    }

    // Default to unknown if no patterns match
    return {
      category: 'unknown',
      message,
      ...location,
      suggestion: 'Review the error output carefully',
      originalError: stderr
    };
  }

  /**
   * Get the appropriate fix strategy prompt for an error category
   */
  getFixStrategy(category: ErrorCategory): string {
    return this.fixStrategies.get(category) || this.fixStrategies.get('unknown')!;
  }

  /**
   * Initialize category-specific fix strategies
   */
  private initializeFixStrategies(): void {
    this.fixStrategies.set('syntax', `You are fixing a SYNTAX ERROR.
The code has invalid syntax that prevents parsing.

Common causes:
- Missing or extra brackets, braces, parentheses
- Missing semicolons or commas
- Unclosed string literals
- Invalid characters or encoding issues

Fix approach:
1. Locate the exact line mentioned in the error
2. Check for balanced brackets/braces on that line and surrounding lines
3. Verify all string literals are properly closed
4. Ensure proper statement termination`);

    this.fixStrategies.set('type', `You are fixing a TYPE ERROR.
The code has type mismatches or incorrect type usage.

Common causes:
- Assigning wrong type to a variable
- Missing type annotations
- Incorrect function parameter types
- Property access on wrong type

Fix approach:
1. Review the types involved in the error
2. Add or correct type annotations
3. Use type guards or assertions if needed
4. Ensure interfaces/types are properly imported`);

    this.fixStrategies.set('import', `You are fixing an IMPORT ERROR.
A module or dependency cannot be found.

Common causes:
- Typo in import path
- Missing .js extension for ESM
- Module not installed
- Incorrect relative path

Fix approach:
1. Verify the import path is correct
2. Add .js extension if using ESM
3. Check if the module exists at the specified path
4. Use correct relative path notation`);

    this.fixStrategies.set('runtime', `You are fixing a RUNTIME ERROR.
The code crashes during execution.

Common causes:
- Accessing undefined/null values
- Calling methods on wrong types
- Stack overflow from recursion
- Unhandled edge cases

Fix approach:
1. Add null/undefined checks
2. Validate inputs before using them
3. Add base case for recursive functions
4. Handle edge cases explicitly`);

    this.fixStrategies.set('assertion', `You are fixing a TEST ASSERTION FAILURE.
The test expected one value but received another.

IMPORTANT: Determine if the BUG is in the code or the test.

Analysis approach:
1. Read the expected vs actual values
2. Understand what the test is verifying
3. Check if the implementation matches the specification
4. If the code is wrong, fix the implementation
5. If the test is wrong, fix the test expectation`);

    this.fixStrategies.set('timeout', `You are fixing a TIMEOUT ERROR.
An async operation took too long.

Common causes:
- Missing await keyword
- Promise never resolves
- Infinite loop
- Slow network/IO operation

Fix approach:
1. Ensure all promises are awaited
2. Add timeout handling
3. Check for infinite loops
4. Mock slow operations in tests`);

    this.fixStrategies.set('permission', `You are fixing a PERMISSION ERROR.
File or resource access was denied.

Common causes:
- Writing to read-only location
- Accessing system-protected files
- Missing directory creation

Fix approach:
1. Use a different output path
2. Ensure parent directories exist
3. Check file system permissions`);

    this.fixStrategies.set('resource', `You are fixing a RESOURCE NOT FOUND error.
A file or directory doesn't exist.

Common causes:
- Wrong file path
- File not created yet
- Directory doesn't exist

Fix approach:
1. Verify the path is correct
2. Create parent directories first
3. Check file creation order`);

    this.fixStrategies.set('network', `You are fixing a NETWORK ERROR.
A network request failed.

Common causes:
- Service not running
- Wrong URL/port
- Network unavailable
- Mock not configured

Fix approach:
1. Mock network calls in tests
2. Add retry logic for production
3. Handle connection errors gracefully`);

    this.fixStrategies.set('unknown', `You are fixing an UNKNOWN ERROR.
The error type could not be automatically classified.

Analysis approach:
1. Read the full error message carefully
2. Search for the specific error in the output
3. Identify the root cause
4. Apply appropriate fix based on error details`);
  }

  /**
   * Analyze multiple errors and return the most impactful one to fix
   */
  analyzeMultiple(stderr: string, exitCode: number): ClassifiedError[] {
    const errors: ClassifiedError[] = [];
    const lines = stderr.split('\n');
    let currentError = '';

    for (const line of lines) {
      if (this.isErrorStart(line)) {
        if (currentError) {
          errors.push(this.classify(currentError, exitCode));
        }
        currentError = line;
      } else if (currentError) {
        currentError += '\n' + line;
      }
    }

    if (currentError) {
      errors.push(this.classify(currentError, exitCode));
    }

    // If no structured errors found, classify the whole output
    if (errors.length === 0) {
      errors.push(this.classify(stderr, exitCode));
    }

    return errors;
  }

  /**
   * Check if a line marks the start of a new error
   */
  private isErrorStart(line: string): boolean {
    return /^\s*(Error|TypeError|SyntaxError|ReferenceError|FAIL|error TS\d+)/i.test(line);
  }
}

/**
 * Singleton instance for convenience
 */
export const errorClassifier = new ErrorClassifier();

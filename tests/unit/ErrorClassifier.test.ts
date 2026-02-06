// =============================================================================
// OpenClaw DevEngine - ErrorClassifier Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ErrorClassifier, errorClassifier } from '../../src/core/ErrorClassifier.js';

describe('ErrorClassifier', () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
  });

  describe('classify() - Syntax Errors', () => {
    it('should classify SyntaxError', () => {
      const stderr = `SyntaxError: Unexpected token '}'
    at new Script (vm.js:80:7)`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('syntax');
      expect(result.suggestion).toBeDefined();
    });

    it('should classify TypeScript syntax errors (TS1xxx)', () => {
      const stderr = `src/app.ts:10:5 - error TS1005: ';' expected.`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('syntax');
    });

    it('should classify Unexpected token errors', () => {
      const stderr = `Parsing error: Unexpected token, expected ","`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('syntax');
    });
  });

  describe('classify() - Type Errors', () => {
    it('should classify TypeError', () => {
      const stderr = `TypeError: Cannot read property 'map' of undefined`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('type');
    });

    it('should classify TypeScript type errors (TS2xxx)', () => {
      const stderr = `src/service.ts:15:10 - error TS2322: Type 'string' is not assignable to type 'number'.`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('type');
    });

    it('should classify type assignability errors', () => {
      const stderr = `Type 'User' is not assignable to type 'Admin'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('type');
    });

    it('should classify property not existing errors', () => {
      const stderr = `Property 'foo' does not exist on type 'Bar'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('type');
    });

    it('should classify cannot find name errors', () => {
      const stderr = `Cannot find name 'MyType'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('type');
    });
  });

  describe('classify() - Import Errors', () => {
    it('should classify module not found errors', () => {
      const stderr = `Cannot find module './missing-file'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('import');
      expect(result.suggestion).toContain('missing-file');
    });

    it('should classify ERR_MODULE_NOT_FOUND', () => {
      const stderr = `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('import');
    });

    it('should classify module resolution errors', () => {
      const stderr = `Unable to resolve module './types' from 'src/index.ts'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('import');
    });
  });

  describe('classify() - Runtime Errors', () => {
    it('should classify ReferenceError', () => {
      const stderr = `ReferenceError: myVariable is not defined`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('runtime');
    });

    it('should classify RangeError', () => {
      const stderr = `RangeError: Maximum call stack size exceeded`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('runtime');
    });

    it('should classify undefined is not a function (without TypeError prefix)', () => {
      // Note: "TypeError: undefined is not a function" matches 'type' because 
      // TypeError pattern comes first. Test the pattern without prefix.
      const stderr = `undefined is not a function`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('runtime');
    });

    it('should classify null is not an object (without TypeError prefix)', () => {
      // Note: "TypeError: null is not an object" matches 'type' because
      // TypeError pattern comes first. Test the pattern without prefix.
      const stderr = `null is not an object (evaluating 'obj.property')`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('runtime');
    });
  });

  describe('classify() - Assertion Errors', () => {
    it('should classify Jest expect failures', () => {
      const stderr = `
expect(received).toBe(expected)

Expected: 5
Received: 3`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('assertion');
      // Expected/actual are extracted into the suggestion
      expect(result.suggestion).toBeDefined();
    });

    it('should classify AssertionError', () => {
      const stderr = `AssertionError: expected true to be false`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('assertion');
    });

    it('should classify FAIL test output', () => {
      const stderr = `FAIL src/utils.test.ts`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('assertion');
    });

    it('should classify chai-style assertions', () => {
      const stderr = `expected 'hello' to equal 'world'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('assertion');
    });
  });

  describe('classify() - Timeout Errors', () => {
    it('should classify timeout errors', () => {
      const stderr = `Timeout - Async callback was not invoked within 5000ms`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('timeout');
    });

    it('should classify Jest test timeout', () => {
      const stderr = `Test timeout of 5000ms exceeded`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('timeout');
    });

    it('should classify ETIMEDOUT', () => {
      const stderr = `Error: connect ETIMEDOUT 10.0.0.1:443`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('timeout');
    });
  });

  describe('classify() - Permission Errors', () => {
    it('should classify EACCES errors', () => {
      const stderr = `Error: EACCES: permission denied, open '/etc/passwd'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('permission');
    });

    it('should classify Permission denied', () => {
      const stderr = `Permission denied: Cannot write to /root/file.txt`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('permission');
    });

    it('should classify EPERM', () => {
      const stderr = `Error: EPERM: operation not permitted`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('permission');
    });
  });

  describe('classify() - Resource Errors', () => {
    it('should classify ENOENT errors', () => {
      const stderr = `Error: ENOENT: no such file or directory, open '/path/to/file.txt'`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('resource');
      expect(result.suggestion).toContain('/path/to/file.txt');
    });

    it('should classify No such file errors', () => {
      const stderr = `No such file or directory: config.json`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('resource');
    });

    it('should classify File not found', () => {
      const stderr = `File not found: data.json`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('resource');
    });
  });

  describe('classify() - Network Errors', () => {
    it('should classify ECONNREFUSED', () => {
      const stderr = `Error: connect ECONNREFUSED 127.0.0.1:3000`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('network');
    });

    it('should classify ENOTFOUND', () => {
      const stderr = `Error: getaddrinfo ENOTFOUND api.example.com`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('network');
    });

    it('should classify ECONNRESET', () => {
      const stderr = `Error: read ECONNRESET`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('network');
    });
  });

  describe('classify() - Location Extraction', () => {
    it('should extract file and line from stack trace', () => {
      const stderr = `TypeError: Cannot read property 'x' of undefined
    at processData (/app/src/service.ts:42:15)
    at main (/app/src/index.ts:10:5)`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.file).toBe('/app/src/service.ts');
      expect(result.line).toBe(42);
      expect(result.column).toBe(15);
    });

    it('should extract location from TypeScript errors', () => {
      const stderr = `src/app.ts:25:10 - error TS2345: Argument of type...`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.file).toBe('src/app.ts');
      expect(result.line).toBe(25);
      expect(result.column).toBe(10);
    });
  });

  describe('classify() - Unknown Errors', () => {
    it('should classify unrecognized errors as unknown', () => {
      const stderr = `Something weird happened that we don't recognize`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.category).toBe('unknown');
    });

    it('should still extract message for unknown errors', () => {
      const stderr = `Custom Error: This is unusual`;
      
      const result = classifier.classify(stderr, 1);
      
      expect(result.message).toContain('Custom Error');
    });
  });

  describe('getFixStrategy()', () => {
    it('should return syntax fix strategy', () => {
      const strategy = classifier.getFixStrategy('syntax');
      
      expect(strategy).toContain('SYNTAX ERROR');
      expect(strategy).toContain('bracket');
    });

    it('should return type fix strategy', () => {
      const strategy = classifier.getFixStrategy('type');
      
      expect(strategy).toContain('TYPE ERROR');
      expect(strategy).toContain('type');
    });

    it('should return import fix strategy', () => {
      const strategy = classifier.getFixStrategy('import');
      
      expect(strategy).toContain('IMPORT ERROR');
      expect(strategy).toContain('path');
    });

    it('should return assertion fix strategy', () => {
      const strategy = classifier.getFixStrategy('assertion');
      
      expect(strategy).toContain('ASSERTION');
      expect(strategy).toContain('expected');
    });

    it('should return unknown strategy for unrecognized category', () => {
      const strategy = classifier.getFixStrategy('nonexistent' as any);
      
      expect(strategy).toContain('UNKNOWN');
    });
  });

  describe('analyzeMultiple()', () => {
    it('should parse multiple errors from output', () => {
      const stderr = `
Error: First error message

TypeError: Second error message

SyntaxError: Third error message
`;
      const errors = classifier.analyzeMultiple(stderr, 1);
      
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle single error', () => {
      const stderr = `TypeError: Single error`;
      
      const errors = classifier.analyzeMultiple(stderr, 1);
      
      expect(errors.length).toBe(1);
      expect(errors[0].category).toBe('type');
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton errorClassifier', () => {
      expect(errorClassifier).toBeInstanceOf(ErrorClassifier);
    });

    it('should work the same as a new instance', () => {
      const stderr = `TypeError: Cannot read property 'x' of undefined`;
      
      const singletonResult = errorClassifier.classify(stderr, 1);
      const instanceResult = classifier.classify(stderr, 1);
      
      expect(singletonResult.category).toBe(instanceResult.category);
    });
  });
});

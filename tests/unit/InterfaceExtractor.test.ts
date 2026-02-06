// =============================================================================
// OpenClaw DevEngine - InterfaceExtractor Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as ts from 'typescript';
import { InterfaceExtractor } from '../../src/core/InterfaceExtractor.js';

describe('InterfaceExtractor', () => {
  let extractor: InterfaceExtractor;

  beforeEach(() => {
    extractor = new InterfaceExtractor();
  });

  describe('extract()', () => {
    it('should extract interface declarations', () => {
      const code = `
export interface User {
  id: string;
  name: string;
  email: string;
}
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('interface User');
      expect(result).toContain('id: string');
      expect(result).toContain('name: string');
      expect(result).toContain('email: string');
    });

    it('should extract type alias declarations', () => {
      const code = `
export type Status = 'pending' | 'active' | 'completed';
export type UserId = string;
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('type Status');
      expect(result).toContain('type UserId');
    });

    it('should extract class declarations with method signatures', () => {
      const code = `
export class UserService {
  private db: Database;
  
  constructor(db: Database) {
    this.db = db;
  }
  
  async getUser(id: string): Promise<User> {
    return this.db.find(id);
  }
  
  async createUser(data: CreateUserDto): Promise<User> {
    const user = new User(data);
    await this.db.save(user);
    return user;
  }
  
  private validateEmail(email: string): boolean {
    return email.includes('@');
  }
}
`;
      const result = extractor.extract(code);
      
      // Should include class declaration
      expect(result).toContain('class UserService');
      
      // Should include public method signatures
      expect(result).toContain('getUser');
      expect(result).toContain('createUser');
      
      // Should NOT include private methods by default
      expect(result).not.toContain('validateEmail');
      
      // Should NOT include method bodies
      expect(result).not.toContain('this.db.find');
      expect(result).not.toContain('new User');
    });

    it('should extract function declarations', () => {
      const code = `
export function add(a: number, b: number): number {
  return a + b;
}

export async function fetchData<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return response.json();
}
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('function add');
      expect(result).toContain('a: number');
      expect(result).toContain('b: number');
      expect(result).toContain(': number');
      
      expect(result).toContain('function fetchData');
      expect(result).toContain('<T>');
      expect(result).toContain('Promise<T>');
    });

    it('should extract enum declarations', () => {
      const code = `
export enum Status {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed'
}
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('enum Status');
      expect(result).toContain('Pending');
      expect(result).toContain('Active');
      expect(result).toContain('Completed');
    });

    it('should skip non-exported declarations by default', () => {
      const code = `
interface PrivateInterface {
  secret: string;
}

class PrivateClass {
  doSomething(): void {}
}

function privateFunction(): void {}

export interface PublicInterface {
  visible: string;
}
`;
      const result = extractor.extract(code);
      
      expect(result).not.toContain('PrivateInterface');
      expect(result).not.toContain('PrivateClass');
      expect(result).not.toContain('privateFunction');
      expect(result).toContain('PublicInterface');
    });

    it('should include private declarations when option is set', () => {
      const code = `
interface PrivateInterface {
  secret: string;
}

export interface PublicInterface {
  visible: string;
}
`;
      const result = extractor.extract(code, { includePrivate: true });
      
      expect(result).toContain('PrivateInterface');
      expect(result).toContain('PublicInterface');
    });

    it('should handle complex generic types', () => {
      const code = `
export interface Repository<T extends Entity> {
  find(id: string): Promise<T | null>;
  findAll(filter: Partial<T>): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}

export type Mapper<TInput, TOutput> = (input: TInput) => TOutput;
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('Repository<T extends Entity>');
      expect(result).toContain('Promise<T | null>');
      expect(result).toContain('Mapper<TInput, TOutput>');
    });

    it('should handle class with heritage clauses', () => {
      const code = `
export class AdminUser extends User implements Serializable, Auditable {
  role: string = 'admin';
  
  getPermissions(): string[] {
    return ['read', 'write', 'delete'];
  }
}
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('class AdminUser');
      expect(result).toContain('extends User');
      expect(result).toContain('implements Serializable');
      expect(result).toContain('Auditable');
    });

    it('should handle getters and setters', () => {
      const code = `
export class Config {
  private _value: string = '';
  
  get value(): string {
    return this._value;
  }
  
  set value(v: string) {
    this._value = v;
  }
}
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('get value');
      expect(result).toContain('set value');
    });

    it('should return placeholder for empty/no exports', () => {
      const code = `
// Just a comment
const internal = 'not exported';
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('No public exports');
    });
  });

  describe('extractSymbols()', () => {
    it('should return structured symbol information', () => {
      const code = `
export interface User {
  id: string;
}

export class UserService {
  getUser(id: string): User { return {} as User; }
}

export function createUser(): User {
  return {} as User;
}

export type UserId = string;
`;
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );
      
      const symbols = extractor.extractSymbols(sourceFile);
      
      expect(symbols).toHaveLength(4);
      
      const interfaceSymbol = symbols.find(s => s.name === 'User');
      expect(interfaceSymbol).toBeDefined();
      expect(interfaceSymbol?.kind).toBe('interface');
      expect(interfaceSymbol?.exported).toBe(true);
      
      const classSymbol = symbols.find(s => s.name === 'UserService');
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.kind).toBe('class');
      
      const functionSymbol = symbols.find(s => s.name === 'createUser');
      expect(functionSymbol).toBeDefined();
      expect(functionSymbol?.kind).toBe('function');
      
      const typeSymbol = symbols.find(s => s.name === 'UserId');
      expect(typeSymbol).toBeDefined();
      expect(typeSymbol?.kind).toBe('type');
    });
  });

  describe('static extract()', () => {
    it('should work as static convenience method', () => {
      const code = `
export interface User {
  id: string;
  name: string;
}
`;
      const result = InterfaceExtractor.extract(code);
      
      expect(result).toContain('interface User');
      expect(result).toContain('id: string');
    });
  });

  describe('extractMultiple()', () => {
    it('should extract and merge from multiple files', () => {
      const files = [
        {
          path: 'src/types.ts',
          code: `
export interface User {
  id: string;
}
`
        },
        {
          path: 'src/services.ts',
          code: `
export class UserService {
  getUser(id: string): User { return {} as User; }
}
`
        }
      ];
      
      const result = InterfaceExtractor.extractMultiple(files);
      
      expect(result).toContain('From: src/types.ts');
      expect(result).toContain('interface User');
      expect(result).toContain('From: src/services.ts');
      expect(result).toContain('class UserService');
    });

    it('should skip files with no exports', () => {
      const files = [
        {
          path: 'src/internal.ts',
          code: `const internal = 'private';`
        },
        {
          path: 'src/types.ts',
          code: `export interface User { id: string; }`
        }
      ];
      
      const result = InterfaceExtractor.extractMultiple(files);
      
      expect(result).not.toContain('internal.ts');
      expect(result).toContain('types.ts');
    });
  });

  describe('edge cases', () => {
    it('should handle empty code', () => {
      const result = extractor.extract('');
      expect(result).toContain('No public exports');
    });

    it('should handle code with only comments', () => {
      const code = `
// This is a comment
/* Multi-line
   comment */
`;
      const result = extractor.extract(code);
      expect(result).toContain('No public exports');
    });

    it('should handle syntax errors gracefully', () => {
      // TypeScript parser is fairly resilient
      const code = `
export interface User {
  id: string
  // Missing closing brace
`;
      // Should not throw, may return partial or empty
      expect(() => extractor.extract(code)).not.toThrow();
    });

    it('should handle arrow function exports', () => {
      const code = `
export const add = (a: number, b: number): number => a + b;
`;
      const result = extractor.extract(code);
      
      expect(result).toContain('add');
    });

    it('should handle re-exports', () => {
      const code = `
export { User } from './types.js';
export * from './services.js';
`;
      // Re-exports are tricky - we mainly want to not crash
      expect(() => extractor.extract(code)).not.toThrow();
    });
  });
});

// =============================================================================
// OpenClaw DevEngine - AST-based Interface Extractor
// =============================================================================

import * as ts from 'typescript';

export interface ExtractionOptions {
  includePrivate?: boolean;
  includeImplementations?: boolean;
  maxDepth?: number;
  preserveComments?: boolean;
}

export interface ExtractedSymbol {
  kind: 'class' | 'interface' | 'type' | 'function' | 'variable' | 'enum';
  name: string;
  signature: string;
  exported: boolean;
}

/**
 * AST-based interface extractor using the TypeScript Compiler API.
 * Extracts public API signatures from TypeScript code while stripping implementations.
 */
export class InterfaceExtractor {
  private readonly printer: ts.Printer;

  constructor() {
    this.printer = ts.createPrinter({
      removeComments: true,
      omitTrailingSemicolon: false
    });
  }

  /**
   * Extract public interface signatures from TypeScript code.
   * Returns a condensed representation suitable for LLM context.
   */
  extract(code: string, options: ExtractionOptions = {}): string {
    const sourceFile = ts.createSourceFile(
      'temp.ts',
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const symbols = this.extractSymbols(sourceFile, options);
    return this.formatSymbols(symbols);
  }

  /**
   * Extract structured symbol information from a source file
   */
  extractSymbols(sourceFile: ts.SourceFile, options: ExtractionOptions = {}): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    const visit = (node: ts.Node) => {
      const extracted = this.extractNode(node, sourceFile, options);
      if (extracted) {
        symbols.push(extracted);
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return symbols;
  }

  /**
   * Extract a single node into an ExtractedSymbol if applicable
   */
  private extractNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    options: ExtractionOptions
  ): ExtractedSymbol | null {
    const exported = this.hasExportModifier(node);
    
    // Skip non-exported unless explicitly requested
    if (!exported && !options.includePrivate) {
      return null;
    }

    if (ts.isInterfaceDeclaration(node)) {
      return {
        kind: 'interface',
        name: node.name.text,
        signature: this.printInterface(node, sourceFile),
        exported
      };
    }

    if (ts.isTypeAliasDeclaration(node)) {
      return {
        kind: 'type',
        name: node.name.text,
        signature: this.printer.printNode(ts.EmitHint.Unspecified, node, sourceFile),
        exported
      };
    }

    if (ts.isClassDeclaration(node) && node.name) {
      return {
        kind: 'class',
        name: node.name.text,
        signature: this.printClassSignature(node, sourceFile, options),
        exported
      };
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      return {
        kind: 'function',
        name: node.name.text,
        signature: this.printFunctionSignature(node, sourceFile),
        exported
      };
    }

    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        return {
          kind: 'variable',
          name: declaration.name.text,
          signature: this.printVariableSignature(node, sourceFile),
          exported
        };
      }
    }

    if (ts.isEnumDeclaration(node)) {
      return {
        kind: 'enum',
        name: node.name.text,
        signature: this.printer.printNode(ts.EmitHint.Unspecified, node, sourceFile),
        exported
      };
    }

    return null;
  }

  /**
   * Print interface declaration
   */
  private printInterface(node: ts.InterfaceDeclaration, sourceFile: ts.SourceFile): string {
    return this.printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
  }

  /**
   * Print class signature (declaration + method signatures, no implementations)
   */
  private printClassSignature(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    options: ExtractionOptions
  ): string {
    const parts: string[] = [];
    
    // Build modifiers string
    const modifiers = this.getModifiersText(node);
    parts.push(`${modifiers}class ${node.name?.text || 'Anonymous'}`);

    // Heritage clauses (extends, implements)
    if (node.heritageClauses) {
      const heritage = node.heritageClauses
        .map(clause => this.printer.printNode(ts.EmitHint.Unspecified, clause, sourceFile))
        .join(' ');
      parts[0] += ` ${heritage}`;
    }

    parts.push(' {');

    // Extract member signatures
    for (const member of node.members) {
      const memberSig = this.extractMemberSignature(member, sourceFile, options);
      if (memberSig) {
        parts.push('  ' + memberSig);
      }
    }

    parts.push('}');
    return parts.join('\n');
  }

  /**
   * Extract signature for a class member
   */
  private extractMemberSignature(
    member: ts.ClassElement,
    sourceFile: ts.SourceFile,
    options: ExtractionOptions
  ): string | null {
    // Skip private members unless requested
    if (!options.includePrivate && this.hasPrivateModifier(member)) {
      return null;
    }

    if (ts.isConstructorDeclaration(member)) {
      return this.printConstructorSignature(member, sourceFile);
    }

    if (ts.isMethodDeclaration(member)) {
      return this.printMethodSignature(member, sourceFile);
    }

    if (ts.isPropertyDeclaration(member)) {
      return this.printPropertySignature(member, sourceFile);
    }

    if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      return this.printAccessorSignature(member, sourceFile);
    }

    return null;
  }

  /**
   * Print constructor signature
   */
  private printConstructorSignature(
    node: ts.ConstructorDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const params = node.parameters
      .map(p => this.printer.printNode(ts.EmitHint.Unspecified, p, sourceFile))
      .join(', ');
    return `constructor(${params});`;
  }

  /**
   * Print method signature (without body)
   */
  private printMethodSignature(
    node: ts.MethodDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const modifiers = this.getModifiersText(node);
    const name = node.name.getText(sourceFile);
    const typeParams = node.typeParameters
      ? `<${node.typeParameters.map(p => p.getText(sourceFile)).join(', ')}>`
      : '';
    const params = node.parameters
      .map(p => this.printer.printNode(ts.EmitHint.Unspecified, p, sourceFile))
      .join(', ');
    const returnType = node.type 
      ? `: ${this.printer.printNode(ts.EmitHint.Unspecified, node.type, sourceFile)}`
      : '';
    
    return `${modifiers}${name}${typeParams}(${params})${returnType};`;
  }

  /**
   * Print property signature
   */
  private printPropertySignature(
    node: ts.PropertyDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const modifiers = this.getModifiersText(node);
    const name = node.name.getText(sourceFile);
    const optional = node.questionToken ? '?' : '';
    const type = node.type 
      ? `: ${this.printer.printNode(ts.EmitHint.Unspecified, node.type, sourceFile)}`
      : '';
    return `${modifiers}${name}${optional}${type};`;
  }

  /**
   * Print accessor signature
   */
  private printAccessorSignature(
    node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const kind = ts.isGetAccessorDeclaration(node) ? 'get' : 'set';
    const modifiers = this.getModifiersText(node);
    const name = node.name.getText(sourceFile);
    
    if (ts.isGetAccessorDeclaration(node)) {
      const returnType = node.type 
        ? `: ${this.printer.printNode(ts.EmitHint.Unspecified, node.type, sourceFile)}`
        : '';
      return `${modifiers}${kind} ${name}()${returnType};`;
    } else {
      const param = node.parameters[0];
      const paramStr = param 
        ? this.printer.printNode(ts.EmitHint.Unspecified, param, sourceFile)
        : 'value';
      return `${modifiers}${kind} ${name}(${paramStr});`;
    }
  }

  /**
   * Print function signature (without body)
   */
  private printFunctionSignature(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const modifiers = this.getModifiersText(node);
    const name = node.name?.text || 'anonymous';
    const typeParams = node.typeParameters
      ? `<${node.typeParameters.map(p => p.getText(sourceFile)).join(', ')}>`
      : '';
    const params = node.parameters
      .map(p => this.printer.printNode(ts.EmitHint.Unspecified, p, sourceFile))
      .join(', ');
    const returnType = node.type 
      ? `: ${this.printer.printNode(ts.EmitHint.Unspecified, node.type, sourceFile)}`
      : '';
    
    return `${modifiers}function ${name}${typeParams}(${params})${returnType};`;
  }

  /**
   * Print variable signature
   */
  private printVariableSignature(
    node: ts.VariableStatement,
    sourceFile: ts.SourceFile
  ): string {
    const modifiers = this.getModifiersText(node);
    const kind = node.declarationList.flags & ts.NodeFlags.Const ? 'const' : 
                 node.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
    
    const declarations = node.declarationList.declarations.map(d => {
      const name = d.name.getText(sourceFile);
      const type = d.type 
        ? `: ${this.printer.printNode(ts.EmitHint.Unspecified, d.type, sourceFile)}`
        : '';
      return `${name}${type}`;
    }).join(', ');

    return `${modifiers}${kind} ${declarations};`;
  }

  /**
   * Format extracted symbols into a string suitable for LLM context
   */
  private formatSymbols(symbols: ExtractedSymbol[]): string {
    if (symbols.length === 0) {
      return '// No public exports found';
    }

    const grouped: Record<string, ExtractedSymbol[]> = {
      interface: [],
      type: [],
      class: [],
      function: [],
      variable: [],
      enum: []
    };

    for (const symbol of symbols) {
      grouped[symbol.kind].push(symbol);
    }

    const parts: string[] = [];

    // Order: types/interfaces first (dependencies), then classes/functions
    for (const kind of ['type', 'interface', 'enum', 'class', 'function', 'variable']) {
      const kindSymbols = grouped[kind];
      if (kindSymbols.length > 0) {
        parts.push(`// ${kind.charAt(0).toUpperCase() + kind.slice(1)}s`);
        for (const symbol of kindSymbols) {
          parts.push(symbol.signature);
          parts.push('');
        }
      }
    }

    return parts.join('\n').trim();
  }

  /**
   * Check if a node has an export modifier
   */
  private hasExportModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  /**
   * Check if a member has a private modifier
   */
  private hasPrivateModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
  }

  /**
   * Get modifiers as a string prefix
   */
  private getModifiersText(node: ts.Node): string {
    if (!ts.canHaveModifiers(node)) return '';
    const modifiers = ts.getModifiers(node);
    if (!modifiers) return '';
    
    const relevantModifiers = modifiers
      .filter(m => 
        m.kind !== ts.SyntaxKind.ExportKeyword && 
        m.kind !== ts.SyntaxKind.DefaultKeyword
      )
      .map(m => m.getText());
    
    return relevantModifiers.length > 0 ? relevantModifiers.join(' ') + ' ' : '';
  }

  /**
   * Static convenience method for simple extraction
   * (Maintains backward compatibility with original API)
   */
  static extract(code: string): string {
    const extractor = new InterfaceExtractor();
    return extractor.extract(code);
  }

  /**
   * Extract and merge interfaces from multiple code files
   */
  static extractMultiple(files: Array<{ path: string; code: string }>): string {
    const extractor = new InterfaceExtractor();
    const parts: string[] = [];

    for (const file of files) {
      const extracted = extractor.extract(file.code);
      if (extracted && !extracted.includes('No public exports')) {
        parts.push(`// From: ${file.path}`);
        parts.push(extracted);
        parts.push('');
      }
    }

    return parts.join('\n').trim();
  }
}

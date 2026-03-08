import * as t from "@babel/types";
import type { Expression, Param, Statement } from "../ir";
import { TypeRef } from "../refs";
import { assertNever, buildTypeParameters, identifierFromName } from "./shared";
import {
  parseTypeString,
  typeDescriptorToImplementsClause,
  typeDescriptorToTSType,
} from "./type-lowering";

function buildFunctionStatement(
  stmt: Extract<Statement, { type: "function" }>,
  id: t.Identifier | null,
  expression = false
): t.FunctionDeclaration | t.FunctionExpression {
  const params = stmt.params.map(paramToBabel);
  const body = t.blockStatement(stmt.body.map(statementToBabel));
  const fn = expression
    ? t.functionExpression(id, params, body)
    : t.functionDeclaration(id, params, body);

  fn.async = stmt.async ?? false;
  fn.typeParameters = buildTypeParameters(stmt.typeParams);
  if (stmt.returnType) {
    const typeDesc =
      typeof stmt.returnType === "string" ? parseTypeString(stmt.returnType) : stmt.returnType;
    fn.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
  }
  return fn;
}

function toDeclarationStatement(
  stmt: Statement,
  context: "export-named" | "declare"
): t.Declaration {
  const declaration = statementToBabel(stmt);
  if (
    t.isVariableDeclaration(declaration) ||
    t.isFunctionDeclaration(declaration) ||
    t.isClassDeclaration(declaration) ||
    t.isTSEnumDeclaration(declaration) ||
    t.isTSInterfaceDeclaration(declaration) ||
    t.isTSTypeAliasDeclaration(declaration) ||
    (context === "declare" && t.isTSModuleDeclaration(declaration))
  ) {
    return declaration;
  }

  throw new Error(`Unsupported ${context} declaration: ${stmt.type}`);
}

function toExportDefaultDeclaration(
  declaration: Statement | Expression
): t.ExportDefaultDeclaration["declaration"] {
  const declarationType =
    typeof declaration === "object" && declaration !== null && "type" in declaration
      ? declaration.type
      : null;

  if (declarationType === "function") {
    const functionStatement = declaration as Extract<Statement, { type: "function" }>;
    return buildFunctionStatement(
      functionStatement,
      functionStatement.name
        ? identifierFromName(functionStatement.name, "Function name")
        : null
    );
  }

  if (declarationType === "class") {
    return statementToBabel(declaration as Statement) as t.ClassDeclaration;
  }

  if (
    declarationType === "let" ||
    declarationType === "const" ||
    declarationType === "if" ||
    declarationType === "for-of" ||
    declarationType === "for-in" ||
    declarationType === "while" ||
    declarationType === "do-while" ||
    declarationType === "return" ||
    declarationType === "throw" ||
    declarationType === "break" ||
    declarationType === "continue" ||
    declarationType === "expression" ||
    declarationType === "block" ||
    declarationType === "type-alias" ||
    declarationType === "interface" ||
    declarationType === "switch" ||
    declarationType === "try" ||
    declarationType === "enum" ||
    declarationType === "import" ||
    declarationType === "export-named" ||
    declarationType === "export-default" ||
    declarationType === "export-all" ||
    declarationType === "namespace" ||
    declarationType === "declare" ||
    declarationType === "raw-stmt"
  ) {
    throw new Error(`Unsupported export-default declaration: ${declarationType}`);
  }

  return expressionToBabel(declaration as Expression);
}

function paramToBabel(p: Param): t.Identifier | t.RestElement | t.AssignmentPattern {
  const id = t.identifier(p.name);

  const typeDesc = p.tsType && (typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType);
  if (p.rest) {
    const restEl = t.restElement(id);
    if (typeDesc) {
      const tsType = typeDescriptorToTSType(typeDesc);
      const restType =
        typeDesc.kind === "array" || typeDesc.kind === "tuple"
          ? tsType
          : t.tsArrayType(tsType);
      restEl.typeAnnotation = t.tsTypeAnnotation(restType);
    }
    return restEl;
  }

  if (typeDesc) {
    id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
  }

  if (p.optional) {
    id.optional = true;
  }

  if (p.default) {
    return t.assignmentPattern(id, expressionToBabel(p.default));
  }

  return id;
}

function memberPropertyToBabel(
  property: string | Expression,
  computed: boolean,
  context: string
): t.Expression | t.Identifier {
  if (!computed) {
    if (typeof property !== "string") {
      throw new Error(`${context} must use a string property when computed is false`);
    }
    return identifierFromName(property, context);
  }

  if (typeof property === "string") {
    return /^\d+$/.test(property)
      ? t.numericLiteral(Number(property))
      : t.stringLiteral(property);
  }

  return expressionToBabel(property);
}

export function expressionToBabel(expr: Expression): t.Expression {
  switch (expr.type) {
    case "literal":
      return (
        typeof expr.value === "string" ? t.stringLiteral(expr.value)
        : typeof expr.value === "number" ? t.numericLiteral(expr.value)
        : typeof expr.value === "boolean" ? t.booleanLiteral(expr.value)
        : t.nullLiteral()
      );

    case "variable":
      return t.identifier(expr.name);

    case "call": {
      const callExpr = t.callExpression(expressionToBabel(expr.callee), expr.args.map(expressionToBabel));
      if (expr.typeArguments && expr.typeArguments.length > 0) {
        callExpr.typeParameters = t.tsTypeParameterInstantiation(
          expr.typeArguments.map(typeDescriptorToTSType)
        );
      }
      return callExpr;
    }

    case "member":
      return t.memberExpression(
        expressionToBabel(expr.object),
        memberPropertyToBabel(expr.property, expr.computed ?? false, "Member property"),
        expr.computed ?? false
      );

    case "binary":
      if (expr.op === "&&" || expr.op === "||") {
        return t.logicalExpression(
          expr.op,
          expressionToBabel(expr.left),
          expressionToBabel(expr.right)
        );
      }
      return t.binaryExpression(
        expr.op as any,
        expressionToBabel(expr.left),
        expressionToBabel(expr.right)
      );

    case "array":
      return t.arrayExpression(expr.elements.map(el => {
        if (el.type === "spread") {
          return t.spreadElement(expressionToBabel(el.argument));
        }
        return expressionToBabel(el);
      }));

    case "object":
      return t.objectExpression(
        Object.entries(expr.properties).map(([key, value]) =>
          t.objectProperty(t.identifier(key), expressionToBabel(value))
        )
      );

    case "template": {
      const quasis = expr.parts.map((part, i) =>
        t.templateElement({ raw: part, cooked: part }, i === expr.parts.length - 1)
      );
      return t.templateLiteral(quasis, expr.expressions.map(expressionToBabel));
    }

    case "await":
      return t.awaitExpression(expressionToBabel(expr.argument));

    case "unary":
      return t.unaryExpression(expr.operator as any, expressionToBabel(expr.operand));

    case "raw":
      return identifierFromName(expr.code, "Raw expression");

    case "conditional":
      return t.conditionalExpression(
        expressionToBabel(expr.test),
        expressionToBabel(expr.consequent),
        expressionToBabel(expr.alternate)
      );

    case "spread":
      throw new Error("Spread expressions are only valid inside array literals");

    case "nullish":
      return t.logicalExpression("??", expressionToBabel(expr.left), expressionToBabel(expr.right));

    case "new": {
      const newExpr = t.newExpression(
        expressionToBabel(expr.callee),
        expr.arguments.map(expressionToBabel)
      );
      if (expr.typeArguments && expr.typeArguments.length > 0) {
        newExpr.typeParameters = t.tsTypeParameterInstantiation(
          expr.typeArguments.map(typeDescriptorToTSType)
        );
      }
      return newExpr;
    }

    case "this":
      return t.thisExpression();

    case "undefined":
      return t.identifier("undefined");

    case "optional-member":
      return t.optionalMemberExpression(
        expressionToBabel(expr.object),
        memberPropertyToBabel(expr.property, expr.computed ?? false, "Optional member property"),
        expr.computed ?? false,
        true
      );

    case "optional-call":
      return t.optionalCallExpression(
        expressionToBabel(expr.callee),
        expr.arguments.map(expressionToBabel),
        true
      );

    case "as":
      return t.tsAsExpression(
        expressionToBabel(expr.expression),
        typeDescriptorToTSType(expr.typeAnnotation)
      );

    case "satisfies":
      return t.tsSatisfiesExpression(
        expressionToBabel(expr.expression),
        typeDescriptorToTSType(expr.typeAnnotation)
      );

    case "non-null":
      return t.tsNonNullExpression(expressionToBabel(expr.expression));

    case "arrow": {
      const params = expr.params.map(paramToBabel);
      const body =
        Array.isArray(expr.body)
          ? t.blockStatement(expr.body.map(statementToBabel))
          : expressionToBabel(expr.body);

      const arrowFunc = t.arrowFunctionExpression(params, body, expr.async ?? false);

      if (expr.returnType) {
        const typeDesc =
          typeof expr.returnType === "string"
            ? parseTypeString(expr.returnType)
            : expr.returnType;
        arrowFunc.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
      }

      return arrowFunc;
    }

    case "update":
      return t.updateExpression(expr.operator, expressionToBabel(expr.argument), expr.prefix);

    case "tagged-template":
      return t.taggedTemplateExpression(
        expressionToBabel(expr.tag),
        expressionToBabel(expr.quasi) as t.TemplateLiteral
      );

    case "assignment":
      return t.assignmentExpression(
        expr.operator,
        expressionToBabel(expr.left) as t.LVal,
        expressionToBabel(expr.right)
      );
  }

  return assertNever(expr as never, "expression");
}

export function statementToBabel(stmt: Statement): t.Statement {
  switch (stmt.type) {
    case "let": {
      const declarator = t.variableDeclarator(
        t.identifier(stmt.name),
        expressionToBabel(stmt.value)
      );
      if (stmt.tsType) {
        const typeDesc =
          typeof stmt.tsType === "string" ? parseTypeString(stmt.tsType) : stmt.tsType;
        (declarator.id as t.Identifier).typeAnnotation = t.tsTypeAnnotation(
          typeDescriptorToTSType(typeDesc)
        );
      }
      return t.variableDeclaration("let", [declarator]);
    }

    case "const": {
      const declarator = t.variableDeclarator(
        t.identifier(stmt.name),
        expressionToBabel(stmt.value)
      );
      if (stmt.tsType) {
        const typeDesc =
          typeof stmt.tsType === "string" ? parseTypeString(stmt.tsType) : stmt.tsType;
        (declarator.id as t.Identifier).typeAnnotation = t.tsTypeAnnotation(
          typeDescriptorToTSType(typeDesc)
        );
      }
      return t.variableDeclaration("const", [declarator]);
    }

    case "if":
      return t.ifStatement(
        expressionToBabel(stmt.condition),
        t.blockStatement(stmt.then.map(statementToBabel)),
        stmt.else ? t.blockStatement(stmt.else.map(statementToBabel)) : null
      );

    case "for-of":
      return t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(t.identifier(stmt.variable))]),
        expressionToBabel(stmt.iterable),
        t.blockStatement(stmt.body.map(statementToBabel))
      );

    case "for-in":
      return t.forInStatement(
        t.variableDeclaration("const", [t.variableDeclarator(t.identifier(stmt.variable))]),
        expressionToBabel(stmt.iterable),
        t.blockStatement(stmt.body.map(statementToBabel))
      );

    case "return":
      return t.returnStatement(stmt.value ? expressionToBabel(stmt.value) : null);

    case "throw":
      return t.throwStatement(expressionToBabel(stmt.argument));

    case "break":
      return t.breakStatement(stmt.label ? t.identifier(stmt.label) : null);

    case "continue":
      return t.continueStatement(stmt.label ? t.identifier(stmt.label) : null);

    case "while":
      return t.whileStatement(
        expressionToBabel(stmt.test),
        t.blockStatement(stmt.body.map(statementToBabel))
      );

    case "do-while":
      return t.doWhileStatement(
        expressionToBabel(stmt.test),
        t.blockStatement(stmt.body.map(statementToBabel))
      );

    case "expression":
      return t.expressionStatement(expressionToBabel(stmt.expr));

    case "function":
      if (stmt.name) {
        return buildFunctionStatement(
          stmt,
          identifierFromName(stmt.name, "Function name")
        ) as t.FunctionDeclaration;
      }
      return t.expressionStatement(
        buildFunctionStatement(stmt, null, true) as t.FunctionExpression
      );

    case "block":
      return t.blockStatement(stmt.body.map(statementToBabel));

    case "type-alias":
      return t.tsTypeAliasDeclaration(
        identifierFromName(stmt.name, "Type alias name"),
        buildTypeParameters(stmt.typeParams),
        typeDescriptorToTSType(stmt.definition)
      );

    case "interface": {
      const props = Object.entries(stmt.properties).map(([key, type]) => {
        const tsType = type instanceof TypeRef ? type.toDescriptor() : type;
        return t.tsPropertySignature(
          identifierFromName(key, "Interface property key"),
          t.tsTypeAnnotation(typeDescriptorToTSType(tsType))
        );
      });
      return t.tsInterfaceDeclaration(
        identifierFromName(stmt.name, "Interface name"),
        buildTypeParameters(stmt.typeParams),
        null,
        t.tsInterfaceBody(props)
      );
    }

    case "switch":
      return t.switchStatement(
        expressionToBabel(stmt.discriminant),
        stmt.cases.map(c =>
          t.switchCase(
            c.test ? expressionToBabel(c.test) : null,
            c.consequent.map(statementToBabel)
          )
        )
      );

    case "try": {
      const catchClause =
        stmt.handler
          ? t.catchClause(
              stmt.handler.param ? t.identifier(stmt.handler.param.name) : null,
              t.blockStatement(stmt.handler.body.map(statementToBabel))
            )
          : null;

      if (catchClause && stmt.handler?.param?.type) {
        const typeDesc =
          typeof stmt.handler.param.type === "string"
            ? parseTypeString(stmt.handler.param.type)
            : stmt.handler.param.type;
        (catchClause.param as t.Identifier).typeAnnotation = t.tsTypeAnnotation(
          typeDescriptorToTSType(typeDesc)
        );
      }

      return t.tryStatement(
        t.blockStatement(stmt.block.map(statementToBabel)),
        catchClause,
        stmt.finalizer ? t.blockStatement(stmt.finalizer.map(statementToBabel)) : null
      );
    }

    case "raw-stmt":
      return t.expressionStatement(identifierFromName(stmt.code, "Raw statement"));

    case "class": {
      const classBody: t.ClassBody = t.classBody(
        stmt.body.map(member => {
          if (member.type === "property") {
            const key = identifierFromName(member.key, "Class property key");
            const prop = t.classProperty(
              key,
              member.value ? expressionToBabel(member.value) : null,
              member.typeAnnotation
                ? t.tsTypeAnnotation(typeDescriptorToTSType(member.typeAnnotation))
                : null,
              null
            );
            prop.static = member.static ?? false;
            prop.readonly = member.readonly ?? false;
            if (member.accessibility) {
              prop.accessibility = member.accessibility;
            }
            return prop;
          }

          const key = identifierFromName(member.key, "Class method key");
          const params = member.params.map(paramToBabel);
          const body = t.blockStatement(member.body.map(statementToBabel));
          const method = t.classMethod(
            member.kind ?? "method",
            key,
            params,
            body
          );
          method.static = member.static ?? false;
          method.async = member.async ?? false;
          if (member.accessibility) {
            method.accessibility = member.accessibility;
          }
          if (member.returnType) {
            const typeDesc =
              typeof member.returnType === "string"
                ? parseTypeString(member.returnType)
                : member.returnType;
            method.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
          }
          return method;
        })
      );

      const typeParameters = stmt.typeParameters
        ? t.tsTypeParameterDeclaration(
            stmt.typeParameters.map(tp =>
              t.tsTypeParameter(
                tp.constraint ? typeDescriptorToTSType(tp.constraint) : null,
                tp.default ? typeDescriptorToTSType(tp.default) : null,
                tp.name
              )
            )
          )
        : null;

      const superClass = stmt.superClass ? expressionToBabel(stmt.superClass) : null;
      const implementsClause =
        stmt.implements && stmt.implements.length > 0
          ? stmt.implements.map(typeDescriptorToImplementsClause)
          : [];

      const decl = t.classDeclaration(
        identifierFromName(stmt.id, "Class name"),
        superClass,
        classBody,
        null
      );

      decl.typeParameters = typeParameters;
      if (implementsClause.length > 0) {
        decl.implements = implementsClause;
      }

      return decl;
    }

    case "enum": {
      const members = stmt.members.map(member =>
        t.tsEnumMember(
          identifierFromName(member.id, "Enum member name"),
          member.initializer ? expressionToBabel(member.initializer) : undefined
        )
      );

      const enumDecl = t.tsEnumDeclaration(
        identifierFromName(stmt.id, "Enum name"),
        members
      );
      enumDecl.const = stmt.const ?? false;
      return enumDecl;
    }

    case "import": {
      const specifiers: (t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier)[] = [];
      for (const spec of stmt.specifiers) {
        if (spec.type === "specifier") {
          specifiers.push(
            t.importSpecifier(
              t.identifier(spec.local ?? spec.imported),
              identifierFromName(spec.imported, "Import specifier")
            )
          );
        } else if (spec.type === "default") {
          specifiers.push(t.importDefaultSpecifier(identifierFromName(spec.local, "Default import name")));
        } else if (spec.type === "namespace") {
          specifiers.push(t.importNamespaceSpecifier(identifierFromName(spec.local, "Namespace import name")));
        }
      }
      const importDecl = t.importDeclaration(specifiers, t.stringLiteral(stmt.source));
      if (stmt.typeOnly) {
        importDecl.importKind = "type";
      }
      return importDecl;
    }

    case "export-named":
      if (stmt.declaration) {
        return t.exportNamedDeclaration(
          toDeclarationStatement(stmt.declaration, "export-named"),
          [],
          null
        );
      }
      if (stmt.specifiers) {
        const specifiers = stmt.specifiers.map(spec =>
          t.exportSpecifier(
            identifierFromName(spec.local, "Export specifier"),
            identifierFromName(spec.exported ?? spec.local, "Export specifier")
          )
        );
        const exportDecl = t.exportNamedDeclaration(
          null,
          specifiers,
          stmt.source ? t.stringLiteral(stmt.source) : null
        );
        if (stmt.typeOnly) {
          exportDecl.exportKind = "type";
        }
        return exportDecl;
      }
      return t.exportNamedDeclaration(null, [], null);

    case "export-default":
      return t.exportDefaultDeclaration(toExportDefaultDeclaration(stmt.declaration));

    case "export-all":
      if (stmt.exported) {
        return t.exportNamedDeclaration(
          null,
          [t.exportNamespaceSpecifier(identifierFromName(stmt.exported, "Export namespace name"))],
          t.stringLiteral(stmt.source)
        );
      }
      return t.exportAllDeclaration(t.stringLiteral(stmt.source));

    case "namespace":
      return t.tsModuleDeclaration(
        identifierFromName(stmt.id, "Namespace name"),
        t.tsModuleBlock(stmt.body.map(statementToBabel))
      );

    case "declare": {
      const innerDecl = stmt.declaration;
      if (innerDecl.type === "function" && innerDecl.name) {
        const params = innerDecl.params.map(p => {
          const id = identifierFromName(p.name, "Function parameter");
          if (p.tsType) {
            const typeDesc = typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType;
            id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
          }
          return id;
        });

        const returnType = innerDecl.returnType
          ? t.tsTypeAnnotation(
              typeDescriptorToTSType(
                typeof innerDecl.returnType === "string"
                  ? parseTypeString(innerDecl.returnType)
                  : innerDecl.returnType
              )
            )
          : null;

        const fnDecl = t.tsDeclareFunction(
          identifierFromName(innerDecl.name, "Declared function name"),
          buildTypeParameters(innerDecl.typeParams),
          params,
          returnType
        );
        fnDecl.declare = true;
        return fnDecl;
      }

      const innerStmt = toDeclarationStatement(innerDecl, "declare") as any;
      innerStmt.declare = true;
      return innerStmt;
    }
  }

  return assertNever(stmt as never, "statement");
}

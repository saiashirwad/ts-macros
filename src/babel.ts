import { generate } from "@babel/generator";
import * as t from "@babel/types";
import type { Expression, Statement, TSTypeDescriptor } from "./ir";
import { TypeRef } from "./refs";

function typeDescriptorToTSType(typeDesc: TSTypeDescriptor | TypeRef<any>): t.TSType {
  if (typeDesc instanceof TypeRef) {
    return t.tsTypeReference(t.identifier(typeDesc.name));
  }

  switch (typeDesc.kind) {
    case "primitive":
      switch (typeDesc.name) {
        case "string":
          return t.tsStringKeyword();
        case "number":
          return t.tsNumberKeyword();
        case "boolean":
          return t.tsBooleanKeyword();
        case "any":
          return t.tsAnyKeyword();
        case "void":
          return t.tsVoidKeyword();
        case "undefined":
          return t.tsUndefinedKeyword();
        case "null":
          return t.tsNullKeyword();
        case "never":
          return t.tsNeverKeyword();
        case "unknown":
          return t.tsUnknownKeyword();
      }
      break;

    case "array":
      return t.tsArrayType(typeDescriptorToTSType(typeDesc.elementType));

    case "union":
      return t.tsUnionType(typeDesc.types.map(typeDescriptorToTSType));

    case "intersection":
      return t.tsIntersectionType(typeDesc.types.map(typeDescriptorToTSType));

    case "function":
      const params = typeDesc.params.map((paramType, index) => {
        const param = t.identifier(`arg${index}`);
        param.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(paramType));
        return param;
      });
      const returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc.returnType));
      return t.tsFunctionType(null, params, returnType);

    case "object":
      return t.tsTypeLiteral(
        Object.entries(typeDesc.properties).map(([key, propType]) => {
          return t.tsPropertySignature(
            t.identifier(key),
            t.tsTypeAnnotation(typeDescriptorToTSType(propType))
          );
        })
      );

    case "generic":
      if (typeDesc.args.length === 0) {
        return t.tsTypeReference(t.identifier(typeDesc.name));
      }
      return t.tsTypeReference(
        t.identifier(typeDesc.name),
        t.tsTypeParameterInstantiation(typeDesc.args.map(typeDescriptorToTSType))
      );

    case "reference":
      return t.tsTypeReference(t.identifier(typeDesc.name));

    case "literal":
      if (typeof typeDesc.value === "string") {
        return t.tsLiteralType(t.stringLiteral(typeDesc.value));
      }
      if (typeof typeDesc.value === "number") {
        return t.tsLiteralType(t.numericLiteral(typeDesc.value));
      }
      return t.tsLiteralType(t.booleanLiteral(typeDesc.value));

    case "tuple":
      return t.tsTupleType(typeDesc.types.map(typeDescriptorToTSType));
  }
}

function parseTypeString(typeStr: string): TSTypeDescriptor {
  switch (typeStr) {
    case "string":
      return { kind: "primitive", name: "string" };
    case "number":
      return { kind: "primitive", name: "number" };
    case "boolean":
      return { kind: "primitive", name: "boolean" };
    case "any":
      return { kind: "primitive", name: "any" };
    case "void":
      return { kind: "primitive", name: "void" };
    default:
      if (typeStr.endsWith("[]")) {
        const elementType = parseTypeString(typeStr.slice(0, -2));
        return { kind: "array", elementType };
      }
      if (typeStr.includes(" | ")) {
        const unionTypes = typeStr.split(" | ").map(parseTypeString);
        return { kind: "union", types: unionTypes };
      }
      if (typeStr.includes(" & ")) {
        const intersectionTypes = typeStr.split(" & ").map(parseTypeString);
        return { kind: "intersection", types: intersectionTypes };
      }
      return { kind: "reference", name: typeStr };
  }
}

function expressionToBabel(expr: Expression): t.Expression {
  switch (expr.type) {
    case "literal":
      return (
        typeof expr.value === "string" ? t.stringLiteral(expr.value)
        : typeof expr.value === "number" ? t.numericLiteral(expr.value)
        : t.booleanLiteral(expr.value)
      );

    case "variable":
      return t.identifier(expr.name);

    case "call":
      return t.callExpression(expressionToBabel(expr.callee), expr.args.map(expressionToBabel));

    case "member":
      return t.memberExpression(expressionToBabel(expr.object), t.identifier(expr.property));

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
      return t.arrayExpression(expr.elements.map(expressionToBabel));

    case "object":
      return t.objectExpression(
        Object.entries(expr.properties).map(([key, value]) =>
          t.objectProperty(t.identifier(key), expressionToBabel(value))
        )
      );

    case "template":
      const quasis = expr.parts.map((part, i) =>
        t.templateElement({ raw: part, cooked: part }, i === expr.parts.length - 1)
      );
      return t.templateLiteral(quasis, expr.expressions.map(expressionToBabel));

    case "await":
      return t.awaitExpression(expressionToBabel(expr.argument));

    case "unary":
      return t.unaryExpression(expr.operator as any, expressionToBabel(expr.operand));

    case "raw":
      return t.identifier(expr.code);
  }
}

function statementToBabel(stmt: Statement): t.Statement {
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

    case "expression":
      return t.expressionStatement(expressionToBabel(stmt.expr));

    case "function": {
      const params = stmt.params.map(p => {
        const id = t.identifier(p.name);
        if (p.tsType) {
          const typeDesc = typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType;
          id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return id;
      });

      const body = t.blockStatement(stmt.body.map(statementToBabel));

      if (stmt.name) {
        const funcDecl = t.functionDeclaration(t.identifier(stmt.name), params, body);
        if (stmt.returnType) {
          const typeDesc =
            typeof stmt.returnType === "string" ?
              parseTypeString(stmt.returnType)
            : stmt.returnType;
          funcDecl.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return funcDecl;
      } else {
        const arrowFunc = t.arrowFunctionExpression(params, body);
        if (stmt.returnType) {
          const typeDesc =
            typeof stmt.returnType === "string" ?
              parseTypeString(stmt.returnType)
            : stmt.returnType;
          arrowFunc.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return t.expressionStatement(arrowFunc);
      }
    }

    case "block":
      return t.blockStatement(stmt.body.map(statementToBabel));

    case "type-alias": {
      const typeParameters =
        stmt.typeParams ?
          t.tsTypeParameterDeclaration(
            stmt.typeParams.map(param => t.tsTypeParameter(null, null, param))
          )
        : null;
      return t.tsTypeAliasDeclaration(
        t.identifier(stmt.name),
        typeParameters,
        typeDescriptorToTSType(stmt.definition)
      );
    }

    case "interface": {
      const props = Object.entries(stmt.properties).map(([key, type]) => {
        const tsType = type instanceof TypeRef ? type.toDescriptor() : type;
        return t.tsPropertySignature(
          t.identifier(key),
          t.tsTypeAnnotation(typeDescriptorToTSType(tsType))
        );
      });
      const typeParameters =
        stmt.typeParams ?
          t.tsTypeParameterDeclaration(
            stmt.typeParams.map(param => t.tsTypeParameter(null, null, param))
          )
        : null;
      return t.tsInterfaceDeclaration(
        t.identifier(stmt.name),
        typeParameters,
        null,
        t.tsInterfaceBody(props)
      );
    }

    case "raw-stmt":
      return t.expressionStatement(t.identifier(stmt.code));
  }
}

export { generate, expressionToBabel, statementToBabel, typeDescriptorToTSType, parseTypeString };

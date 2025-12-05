import { generate } from "@babel/generator";
import * as t from "@babel/types";
import type { Expression, Statement, TSTypeDescriptor, ClassMember, TypeParameter } from "./ir";
import { TypeRef } from "./refs";

function typeDescriptorToTSType(typeDesc: TSTypeDescriptor | TypeRef<unknown>): t.TSType {
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
        : typeof expr.value === "boolean" ? t.booleanLiteral(expr.value)
        : t.nullLiteral()
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

    case "conditional":
      return t.conditionalExpression(
        expressionToBabel(expr.test),
        expressionToBabel(expr.consequent),
        expressionToBabel(expr.alternate)
      );

    case "spread":
      return t.spreadElement(expressionToBabel(expr.argument)) as unknown as t.Expression;

    case "nullish":
      return t.logicalExpression("??", expressionToBabel(expr.left), expressionToBabel(expr.right));

    case "new":
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

    case "this":
      return t.thisExpression();

    case "optional-member":
      return t.optionalMemberExpression(
        expressionToBabel(expr.object),
        t.identifier(expr.property),
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
      const params = expr.params.map(p => {
        const id = t.identifier(p.name);
        if (p.tsType) {
          const typeDesc = typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType;
          id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return id;
      });

      const body =
        Array.isArray(expr.body) ?
          t.blockStatement(expr.body.map(statementToBabel))
        : expressionToBabel(expr.body);

      const arrowFunc = t.arrowFunctionExpression(params, body, expr.async ?? false);

      if (expr.returnType) {
        const typeDesc =
          typeof expr.returnType === "string" ?
            parseTypeString(expr.returnType)
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
        funcDecl.async = stmt.async ?? false;
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
        stmt.handler ?
          t.catchClause(
            stmt.handler.param ? t.identifier(stmt.handler.param.name) : null,
            t.blockStatement(stmt.handler.body.map(statementToBabel))
          )
        : null;

      if (catchClause && stmt.handler?.param?.type) {
        const typeDesc =
          typeof stmt.handler.param.type === "string" ?
            parseTypeString(stmt.handler.param.type)
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
      return t.expressionStatement(t.identifier(stmt.code));

    case "class": {
      const classBody: t.ClassBody = t.classBody(
        stmt.body.map(member => {
          if (member.type === "property") {
            const key = t.identifier(member.key);
            const prop = t.classProperty(
              key,
              member.value ? expressionToBabel(member.value) : null,
              member.typeAnnotation ? t.tsTypeAnnotation(typeDescriptorToTSType(member.typeAnnotation)) : null,
              null
            );
            prop.static = member.static ?? false;
            prop.readonly = member.readonly ?? false;
            if (member.accessibility) {
              prop.accessibility = member.accessibility;
            }
            return prop;
          } else {
            const key = t.identifier(member.key);
            const params = member.params.map(p => {
              const id = t.identifier(p.name);
              if (p.tsType) {
                const typeDesc = typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType;
                id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
              }
              return id;
            });
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
              const typeDesc = typeof member.returnType === "string" ? parseTypeString(member.returnType) : member.returnType;
              method.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
            }
            return method;
          }
        })
      );

      const typeParameters = stmt.typeParameters ?
        t.tsTypeParameterDeclaration(
          stmt.typeParameters.map(tp => {
            const param = t.tsTypeParameter(
              tp.constraint ? typeDescriptorToTSType(tp.constraint) : null,
              tp.default ? typeDescriptorToTSType(tp.default) : null,
              tp.name
            );
            return param;
          })
        ) : null;

      const superClass = stmt.superClass ? expressionToBabel(stmt.superClass) : null;
      const implementsClause = stmt.implements && stmt.implements.length > 0 ?
        stmt.implements.map(typeDescriptorToTSType).map(tsType =>
          t.tsExpressionWithTypeArguments(
            t.identifier((tsType as any).typeName?.name || "unknown")
          )
        ) : null;

      return t.classDeclaration(
        t.identifier(stmt.id),
        superClass,
        classBody,
        null
      );
    }

    case "enum": {
      const members = stmt.members.map(member => {
        return t.tsEnumMember(
          t.identifier(member.id),
          member.initializer ? expressionToBabel(member.initializer) : undefined
        );
      });

      const enumDecl = t.tsEnumDeclaration(
        t.identifier(stmt.id),
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
              t.identifier(spec.imported)
            )
          );
        } else if (spec.type === "default") {
          specifiers.push(t.importDefaultSpecifier(t.identifier(spec.local)));
        } else if (spec.type === "namespace") {
          specifiers.push(t.importNamespaceSpecifier(t.identifier(spec.local)));
        }
      }
      const importDecl = t.importDeclaration(specifiers, t.stringLiteral(stmt.source));
      if (stmt.typeOnly) {
        importDecl.importKind = "type";
      }
      return importDecl;
    }

    case "export-named": {
      if (stmt.declaration) {
        return t.exportNamedDeclaration(
          statementToBabel(stmt.declaration) as t.Declaration,
          [],
          null
        );
      } else if (stmt.specifiers) {
        const specifiers = stmt.specifiers.map(spec =>
          t.exportSpecifier(
            t.identifier(spec.local),
            t.identifier(spec.exported ?? spec.local)
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
    }

    case "export-default": {
      const decl = stmt.declaration;
      if ((decl as any).type === "function" || (decl as any).type === "class") {
        return t.exportDefaultDeclaration(statementToBabel(decl as Statement) as t.FunctionDeclaration | t.ClassDeclaration);
      } else {
        return t.exportDefaultDeclaration(expressionToBabel(decl as Expression));
      }
    }

    case "export-all": {
      if (stmt.exported) {
        return t.exportNamedDeclaration(
          null,
          [t.exportNamespaceSpecifier(t.identifier(stmt.exported))],
          t.stringLiteral(stmt.source)
        );
      }
      return t.exportAllDeclaration(t.stringLiteral(stmt.source));
    }

    case "namespace": {
      return t.tsModuleDeclaration(
        t.identifier(stmt.id),
        t.tsModuleBlock(stmt.body.map(statementToBabel))
      );
    }

    case "declare": {
      const innerDecl = stmt.declaration;
      if (innerDecl.type === "function" && innerDecl.name) {
        const params = innerDecl.params.map(p => {
          const id = t.identifier(p.name);
          if (p.tsType) {
            const typeDesc = typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType;
            id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
          }
          return id;
        });

        const returnType = innerDecl.returnType ?
          t.tsTypeAnnotation(typeDescriptorToTSType(
            typeof innerDecl.returnType === "string" ?
              parseTypeString(innerDecl.returnType)
            : innerDecl.returnType
          ))
        : null;

        const fnDecl = t.tsDeclareFunction(t.identifier(innerDecl.name), null, params, returnType);
        fnDecl.declare = true;
        return fnDecl;
      }

      const innerStmt = statementToBabel(innerDecl) as any;
      innerStmt.declare = true;
      return innerStmt;
    }
  }
}

export { generate, expressionToBabel, statementToBabel, typeDescriptorToTSType, parseTypeString };

/**
 * TypeScript types for CDP Protocol Schema
 *
 * These types describe the structure of the protocol JSON from devtools-protocol package.
 */

/**
 * CDP Protocol version information.
 */
export interface ProtocolVersion {
  /** Major version (e.g., '1') */
  major: string;
  /** Minor version (e.g., '3') */
  minor: string;
}

/**
 * Parameter or return value type reference.
 */
export interface TypeRef {
  /** Type name (e.g., 'string', 'integer', 'boolean', 'array', 'object') */
  type?: string;
  /** Reference to another type (e.g., 'Network.Cookie') */
  $ref?: string;
  /** Array item type (when type is 'array') */
  items?: TypeRef;
  /** Enum values (when type is 'string' with enum) */
  enum?: string[];
  /** Property definitions (when type is 'object') */
  properties?: Parameter[];
}

/**
 * Command parameter or object property.
 */
export interface Parameter extends TypeRef {
  /** Parameter name */
  name: string;
  /** Parameter description */
  description?: string;
  /** Whether parameter is optional */
  optional?: boolean;
  /** Deprecated flag */
  deprecated?: boolean;
  /** Experimental flag */
  experimental?: boolean;
}

/**
 * Command return value.
 */
export interface ReturnValue extends TypeRef {
  /** Return value name */
  name: string;
  /** Return value description */
  description?: string;
  /** Optional flag */
  optional?: boolean;
}

/**
 * CDP Command (method).
 */
export interface Command {
  /** Command name (e.g., 'getCookies', 'enable') */
  name: string;
  /** Command description */
  description?: string;
  /** Command parameters */
  parameters?: Parameter[];
  /** Command return values */
  returns?: ReturnValue[];
  /** Whether command is experimental */
  experimental?: boolean;
  /** Whether command is deprecated */
  deprecated?: boolean;
  /** URL to specification */
  redirect?: string;
}

/**
 * CDP Event.
 */
export interface Event {
  /** Event name */
  name: string;
  /** Event description */
  description?: string;
  /** Event parameters */
  parameters?: Parameter[];
  /** Whether event is experimental */
  experimental?: boolean;
  /** Whether event is deprecated */
  deprecated?: boolean;
}

/**
 * CDP Type definition.
 */
export interface Type {
  /** Type ID (e.g., 'Cookie', 'Headers') */
  id: string;
  /** Type description */
  description?: string;
  /** Base type */
  type: string;
  /** Enum values (for string enums) */
  enum?: string[];
  /** Properties (for object types) */
  properties?: Parameter[];
  /** Array item type */
  items?: TypeRef;
  /** Whether type is experimental */
  experimental?: boolean;
}

/**
 * CDP Domain (e.g., Network, Runtime, DOM).
 */
export interface Domain {
  /** Domain name (e.g., 'Network', 'Runtime') */
  domain: string;
  /** Domain description */
  description?: string | null;
  /** Domain dependencies */
  dependencies?: string[];
  /** Domain types */
  types?: Type[];
  /** Domain commands */
  commands?: Command[];
  /** Domain events */
  events?: Event[];
  /** Whether domain is experimental */
  experimental?: boolean;
  /** Whether domain is deprecated */
  deprecated?: boolean;
}

/**
 * Full CDP Protocol Schema.
 */
export interface ProtocolSchema {
  /** Protocol version */
  version: ProtocolVersion;
  /** All protocol domains */
  domains: Domain[];
}

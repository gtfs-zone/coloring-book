/**
 * GTFS Metadata utilities for accessing field descriptions and schema information
 */

import {
  getFieldDescription,
  getAllFieldDescriptions,
  getFileSchema as getGTFSFileSchema,
  GTFSSchemas,
  GTFS_FILES,
} from '../types/gtfs';

export class GTFSMetadata {
  /**
   * Get the description for a specific field in a GTFS file
   */
  static getFieldDescription(
    filename: string,
    fieldName: string
  ): string | undefined {
    return getFieldDescription(filename, fieldName);
  }

  /**
   * Get all field descriptions for a GTFS file
   */
  static getAllFieldDescriptions(filename: string): Record<string, string> {
    return getAllFieldDescriptions(filename);
  }

  /**
   * Get the Zod schema for a GTFS file
   */
  static getFileSchema(filename: string) {
    return getGTFSFileSchema(filename);
  }

  /**
   * Get file information including presence requirements
   */
  static getFileInfo(filename: string) {
    return GTFS_FILES.find((file) => file.filename === filename);
  }

  /**
   * Get all available GTFS file names
   */
  static getAllFileNames(): string[] {
    return Object.keys(GTFSSchemas);
  }

  /**
   * Check if a file is required, optional, or conditionally required
   */
  static getFilePresence(filename: string): string | undefined {
    const fileInfo = this.getFileInfo(filename);
    return fileInfo?.presence;
  }

  /**
   * Get formatted field information for UI display
   */
  static getFieldInfo(filename: string, fieldName: string) {
    const description = this.getFieldDescription(filename, fieldName);
    const schema = this.getFileSchema(filename);

    if (!schema || !description) {
      return null;
    }

    // Extract additional information from the schema
    const shape = (schema as Record<string, unknown>).shape;
    const fieldSchema = shape?.[fieldName];

    const isOptional = fieldSchema?._def?.typeName === 'ZodOptional';
    const baseType = isOptional ? fieldSchema._def.innerType : fieldSchema;

    return {
      name: fieldName,
      description,
      required: !isOptional,
      type: baseType?._def?.typeName || 'unknown',
    };
  }

  /**
   * Get all field information for a file formatted for UI display
   */
  static getAllFieldInfo(filename: string) {
    const descriptions = this.getAllFieldDescriptions(filename);
    const schema = this.getFileSchema(filename);

    if (!schema) {
      return [];
    }

    return Object.keys(descriptions)
      .map((fieldName) => this.getFieldInfo(filename, fieldName))
      .filter(Boolean);
  }
}

#!/usr/bin/env node

// Simple test script to verify metadata functionality
import { GTFSMetadata } from './src/utils/gtfs-metadata.js';

console.log('Testing GTFS Metadata System...\n');

// Test 1: Get field description
console.log('1. Testing field description access:');
const stopNameDesc = GTFSMetadata.getFieldDescription('stops.txt', 'stopName');
console.log(`stops.txt -> stopName: ${stopNameDesc?.substring(0, 100)}...`);

const agencyNameDesc = GTFSMetadata.getFieldDescription('agency.txt', 'agencyName');
console.log(`agency.txt -> agencyName: ${agencyNameDesc}`);

// Test 2: Get all field descriptions for a file
console.log('\n2. Testing all field descriptions for agency.txt:');
const agencyDescriptions = GTFSMetadata.getAllFieldDescriptions('agency.txt');
console.log(`Found ${Object.keys(agencyDescriptions).length} fields:`, Object.keys(agencyDescriptions));

// Test 3: Get file info
console.log('\n3. Testing file information:');
const agencyInfo = GTFSMetadata.getFileInfo('agency.txt');
console.log(`agency.txt presence: ${agencyInfo?.presence}`);
console.log(`agency.txt description: ${agencyInfo?.description}`);

// Test 4: Get formatted field info
console.log('\n4. Testing formatted field info:');
const stopNameInfo = GTFSMetadata.getFieldInfo('stops.txt', 'stopName');
console.log('stops.txt -> stopName info:', {
  name: stopNameInfo?.name,
  required: stopNameInfo?.required,
  type: stopNameInfo?.type,
  description: stopNameInfo?.description.substring(0, 50) + '...'
});

// Test 5: Get all file names
console.log('\n5. Available GTFS files:');
const fileNames = GTFSMetadata.getAllFileNames();
console.log(`Total files with schemas: ${fileNames.length}`);
console.log('Sample files:', fileNames.slice(0, 5));

console.log('\nMetadata system test completed successfully!');
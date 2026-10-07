import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CleanCSS from 'clean-css';
import { XMLParser } from 'fast-xml-parser';
import { minify as minifyJs } from 'terser';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const files = {
  theme: path.join(SRC, 'theme.xml'),
  css: path.join(SRC, 'css', 'style.css'),
  js: path.join(SRC, 'js', 'main.js'),
  header: path.join(SRC, 'components', 'header.xml'),
  post: path.join(SRC, 'components', 'post.xml'),
  sidebar: path.join(SRC, 'components', 'sidebar.xml'),
  output: path.join(DIST, 'theme.xml')
};

/**
 * Read a UTF-8 source file.
 */
const readSource = async (filePath) => readFile(filePath, 'utf8');

/**
 * Escape CDATA terminators so arbitrary CSS/JS cannot break
 * the CDATA sections used by the Blogger theme.
 */
const toCdataSafe = (value) => value.replaceAll(']]>', ']]]]><![CDATA[>');

/**
 * Build the complete Blogger theme from the source components.
 */
const buildTheme = async () => {
  const [
    theme,
    cssSource,
    jsSource,
    header,
    post,
    sidebar
  ] = await Promise.all([
    readSource(files.theme),
    readSource(files.css),
    readSource(files.js),
    readSource(files.header),
    readSource(files.post),
    readSource(files.sidebar)
  ]);

  const cssResult = new CleanCSS({
    level: 2
  }).minify(cssSource);

  if (cssResult.errors.length > 0) {
    throw new Error(
      `CSS minification failed:\n${cssResult.errors.join('\n')}`
    );
  }

  const jsResult = await minifyJs(jsSource, {
    compress: true,
    mangle: true,
    format: {
      comments: false
    }
  });

  if (!jsResult.code) {
    throw new Error('JavaScript minification produced no output.');
  }

  let output = theme
    .replace('{{INCLUDE_CSS}}', toCdataSafe(cssResult.styles))
    .replace('{{INCLUDE_JS}}', toCdataSafe(jsResult.code))
    .replace('{{INCLUDE_COMPONENT:header}}', header.trim())
    .replace('{{INCLUDE_COMPONENT:post}}', post.trim())
    .replace('{{INCLUDE_COMPONENT:sidebar}}', sidebar.trim());

  const unresolved = output.match(/\{\{[^}]+\}\}/g);

  if (unresolved) {
    throw new Error(
      `Unresolved build placeholders: ${[...new Set(unresolved)].join(', ')}`
    );
  }

  return output;
};

/**
 * Validate XML syntax with a parser configured to preserve Blogger
 * namespace-qualified element names and attributes.
 *
 * This validates well-formed XML. Blogger-specific semantic validation
 * still needs to be performed by Blogger's theme editor/importer.
 */
const validateBloggerStructure = (xml) => {
  const requiredText = [
    "xmlns:b='http://www.google.com/2005/gml/b'",
    "xmlns:data='http://www.google.com/2005/gml/data'",
    "xmlns:expr='http://www.google.com/2005/gml/expr'",
    "<b:skin",
    "id='main'",
    "id='Blog1'",
    "id='sidebar'",
    "id='HTML1'"
  ];

  for (const value of requiredText) {
    if (!xml.includes(value)) {
      throw new Error(
        `Blogger structure validation failed: missing required marker ${value}.`
      );
    }
  }

  const structuralXml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const count = (pattern) => (structuralXml.match(pattern) ?? []).length;

  const exactCounts = [
    ['b:section', /<b:section\b/g, 2],
    ['b:widget', /<b:widget\b/g, 2],
    ['b:skin', /<b:skin\b/g, 1],
    ['Blog1 widget', /id=['"]Blog1['"]/g, 1],
    ['HTML1 widget', /id=['"]HTML1['"]/g, 1]
  ];

  for (const [label, pattern, expected] of exactCounts) {
    const actual = count(pattern);
    if (actual !== expected) {
      throw new Error(
        `Blogger structure validation failed: expected ${expected} ${label}, found ${actual}.`
      );
    }
  }

  const loopStart = structuralXml.indexOf("<b:loop values='data:posts' var='post'>");
  const postStart = structuralXml.indexOf("<article class='blog-post'");
  const loopEnd = structuralXml.indexOf('</b:loop>', loopStart);

  if (
    loopStart === -1 ||
    postStart === -1 ||
    loopEnd === -1 ||
    postStart < loopStart ||
    postStart > loopEnd
  ) {
    throw new Error(
      'Blogger structure validation failed: post component is not inside the Blog1 post loop.'
    );
  }
};

const validateXml = (xml) => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    allowBooleanAttributes: true,
    processEntities: true,
    trimValues: false
  });

  try {
    parser.parse(xml);
  } catch (error) {
    throw new Error(`Generated theme is not valid XML: ${error.message}`);
  }
};

/**
 * CLI entry point.
 */
const main = async () => {
  const validateOnly = process.argv.includes('--validate-only');
  const output = await buildTheme();

  validateXml(output);
  validateBloggerStructure(output);

  if (validateOnly) {
    console.log('Theme validation passed: generated XML is well-formed.');
    return;
  }

  await mkdir(DIST, { recursive: true });
  await writeFile(files.output, output, 'utf8');

  console.log(`Theme built successfully: ${path.relative(ROOT, files.output)}`);
  console.log(`Generated size: ${Buffer.byteLength(output, 'utf8')} bytes`);
};

main().catch((error) => {
  console.error('Build failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

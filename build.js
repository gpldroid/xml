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

const readSource = (filePath) => readFile(filePath, 'utf8');
const toCdataSafe = (value) => value.replaceAll(']]>', ']]]]><![CDATA[>');

const buildTheme = async () => {
  const [theme, cssSource, jsSource, header, post, sidebar] = await Promise.all([
    readSource(files.theme),
    readSource(files.css),
    readSource(files.js),
    readSource(files.header),
    readSource(files.post),
    readSource(files.sidebar)
  ]);

  const cssResult = new CleanCSS({ level: 2 }).minify(cssSource);
  if (cssResult.errors.length) {
    throw new Error(`CSS minification failed:\n${cssResult.errors.join('\n')}`);
  }

  const jsResult = await minifyJs(jsSource, {
    compress: true,
    mangle: true,
    format: { comments: false }
  });
  if (!jsResult.code) {
    throw new Error('JavaScript minification produced no output.');
  }

  const output = theme
    .replace('{{INCLUDE_CSS}}', toCdataSafe(cssResult.styles))
    .replace('{{INCLUDE_JS}}', toCdataSafe(jsResult.code))
    .replace('{{INCLUDE_COMPONENT:header}}', header.trim())
    .replace('{{INCLUDE_COMPONENT:post}}', post.trim())
    .replace('{{INCLUDE_COMPONENT:sidebar}}', sidebar.trim());

  const unresolved = output.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unresolved build placeholders: ${[...new Set(unresolved)].join(', ')}`);
  }
  return output;
};

const validateBloggerStructure = (xml) => {
  const structuralXml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const required = [
    ['Blogger namespace b', /xmlns:b=['"]http:\/\/www\.google\.com\/2005\/gml\/b['"]/],
    ['Blogger namespace data', /xmlns:data=['"]http:\/\/www\.google\.com\/2005\/gml\/data['"]/],
    ['Blogger namespace expr', /xmlns:expr=['"]http:\/\/www\.google\.com\/2005\/gml\/expr['"]/],
    ['V3 layouts', /b:layoutsVersion=['"]3['"]/],
    ['default widget version 2', /b:defaultwidgetversion=['"]2['"]/],
    ['responsive mode', /b:responsive=['"]true['"]/],
    ['skin', /<b:skin(?=\s|>)/],
    ['layout skin', /<b:template-skin(?=\s|>)/],
    ['header section', /<b:section(?=\s|>)[^>]*\bid=['"]header['"][^>]*\bname=['"]Header['"]/],
    ['navigation section', /<b:section(?=\s|>)[^>]*\bid=['"]navigation['"][^>]*\bname=['"]Navigation['"]/],
    ['main section', /<b:section(?=\s|>)[^>]*\bid=['"]main['"][^>]*\bname=['"]Main['"]/],
    ['sidebar section', /<b:section(?=\s|>)[^>]*\bid=['"]sidebar['"][^>]*\bname=['"]Sidebar['"]/],
    ['footer section', /<b:section(?=\s|>)[^>]*\bid=['"]footer['"][^>]*\bname=['"]Footer['"]/],
    ['Header1 widget', /<b:widget(?=\s|>)[^>]*\bid=['"]Header1['"][^>]*\btype=['"]Header['"][^>]*\bversion=['"]2['"]/],
    ['PageList1 widget', /<b:widget(?=\s|>)[^>]*\bid=['"]PageList1['"][^>]*\btype=['"]PageList['"][^>]*\bversion=['"]2['"]/],
    ['Blog1 widget', /<b:widget(?=\s|>)[^>]*\bid=['"]Blog1['"][^>]*\btype=['"]Blog['"][^>]*\bversion=['"]2['"]/],
    ['HTML1 widget', /<b:widget(?=\s|>)[^>]*\bid=['"]HTML1['"][^>]*\btype=['"]HTML['"][^>]*\bversion=['"]2['"]/],
    ['Blog1 settings', /<b:widget(?=\s|>)[^>]*\bid=['"]Blog1['"][\s\S]*?<b:widget-settings>[\s\S]*?<b:widget-setting name=['"]showCommentLink['"]>/],
    ['HTML1 settings', /<b:widget(?=\s|>)[^>]*\bid=['"]HTML1['"][\s\S]*?<b:widget-settings>[\s\S]*?<b:widget-setting name=['"]content['"]>/]
  ];

  for (const [label, pattern] of required) {
    if (!pattern.test(structuralXml)) {
      throw new Error(`Blogger structure validation failed: ${label} is missing or invalid.`);
    }
  }

  const sectionMatches = [...structuralXml.matchAll(/<b:section(?=\s|>)[^>]*\bid=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/b:section>/g)];
  const sectionIds = sectionMatches.map((m) => m[1]);
  const widgetIds = [...structuralXml.matchAll(/<b:widget(?=\s|>)[^>]*\bid=['"]([^'"]+)['"]/g)].map((m) => m[1]);

  const assertUnique = (label, values) => {
    const duplicates = values.filter((value, i) => values.indexOf(value) !== i);
    if (duplicates.length) {
      throw new Error(`Blogger structure validation failed: duplicate ${label} id(s): ${[...new Set(duplicates)].join(', ')}.`);
    }
  };
  assertUnique('section', sectionIds);
  assertUnique('widget', widgetIds);

  if (sectionIds.length !== 5) {
    throw new Error(`Blogger structure validation failed: expected 5 sections, found ${sectionIds.length}.`);
  }
  if (widgetIds.length !== 4) {
    throw new Error(`Blogger structure validation failed: expected 4 widgets, found ${widgetIds.length}.`);
  }

  // Blogger sections may contain only widgets plus whitespace/comments.
  for (const [, content] of sectionMatches) {
    const withoutWidgets = content
      .replace(/<b:widget(?=\s|>)[\s\S]*?<\/b:widget>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
    if (withoutWidgets) {
      throw new Error('Blogger structure validation failed: b:section contains non-widget content.');
    }
  }

  if (!/<b:widget-setting\b/.test(structuralXml)) {
    throw new Error('Blogger structure validation failed: widget settings are missing.');
  }

  if (/\/\*\s*\/\*/.test(structuralXml)) {
    throw new Error('Blogger structure validation failed: generated CSS is empty/comment-only.');
  }

  if (/\/\/\s*\(\(\)/.test(structuralXml)) {
    throw new Error('Blogger structure validation failed: generated JavaScript is commented out.');
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

const main = async () => {
  const validateOnly = process.argv.includes('--validate-only');
  const output = await buildTheme();
  validateXml(output);
  validateBloggerStructure(output);

  if (validateOnly) {
    console.log('Theme validation passed: XML, Blogger V3 layout structure, native widgets and runtime assets are valid.');
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

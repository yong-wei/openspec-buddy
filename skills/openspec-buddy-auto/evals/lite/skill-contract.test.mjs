#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillPath = path.resolve(here, '../../SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

function requires(pattern, message) {
  assert.match(skill, pattern, message);
}

requires(/scripts\/buddy-auto\.mjs[^\n]*default|default[^\n]*scripts\/buddy-auto\.mjs/i,
  'the public entry must state that no-subcommand execution is lite');
requires(/scripts\/buddy-auto\.mjs full(?:\s|`)/,
  'full mode must be reached only through the public full subcommand');
requires(/select-available-issue\.mjs[\s\S]*claim-issue\.mjs[\s\S]*set-issue-status\.sh/,
  'lite must name exactly the three deterministic coordination scripts');
requires(/smallest|编号最小/,
  'untargeted selection must choose the smallest available issue');
requires(/local change[^\n]*(?:missing|does not exist)|本地 change[^\n]*(?:不存在|缺失)/i,
  'a mapped issue with no local change must stop');
requires(/Local-only[\s\S]*(?:default|默认)[^\n]*PR[\s\S]*--no-pr/,
  'Local-only delivery must default to PR and reserve no-PR for an explicit exception');
requires(/openspec validate <change_id> --strict/,
  'lite completion must strictly validate the active change');
requires(/openspec archive <change_id> --yes/,
  'lite completion must use the standard archive command');
requires(/same (?:PR|delivery unit)|同(?:一个|一) PR|同一交付单元/i,
  'implementation, tests, synchronized specs, and archive must share one delivery unit');
requires(/@codex review 中文回复，即使没有重大问题也必须给出显式回复/,
  'lite must use the fixed review request');
requires(/300[^\n]*60[^\n]*900|300[\s\S]{0,180}60[\s\S]{0,180}900/,
  'the review window must state the 300/60/900 timing');
requires(/(?:one|一次)[^\n]*(?:Timeout Retry|超时复审)|(?:Timeout Retry|超时复审)[^\n]*(?:one|一次)/i,
  'only one automatic timeout retry is allowed');
requires(/(?:second|第二)[^\n]*(?:timeout|超时)[^\n]*(?:stop|停止)/i,
  'a second timeout must stop automation');
requires(/(?:quota|service)[\s\S]{0,180}(?:immediately|立即)[^\n]*(?:stop|停止)/i,
  'quota or service unavailability must stop immediately');
requires(/(?:quota|service)[\s\S]{0,240}(?:does not|不)[^\n]*(?:consume|消耗|trigger|触发)[^\n]*(?:Timeout Retry|超时复审)/i,
  'service unavailability must not consume or trigger the timeout retry');
requires(/feedback[\s\S]{0,500}(?:new head|新 head|最新 head)[\s\S]{0,300}(?:Review Request|复审)/i,
  'code-changing feedback must be tested, locally reviewed, pushed, and rereviewed on the new head');
requires(/(?:no code change|无需代码修改)[\s\S]{0,500}(?:reply|回复)[\s\S]{0,240}(?:resolve|解决)[\s\S]{0,300}(?:same head|同一 head)[\s\S]{0,240}(?:Review Request|复审)/i,
  'no-change feedback must be answered, resolved, explained, and rereviewed on the same head');
requires(/(?:latest head|最新 head)[\s\S]{0,360}(?:Clearance Comment|清场评论)[\s\S]{0,500}(?:unresolved|未解决)[\s\S]{0,360}(?:CI|checks?)/i,
  'merge requires latest-head clearance, no unresolved thread, and successful CI or confirmed absence of CI');
requires(/status:archived[\s\S]{0,300}(?:completion comment|完成评论)[\s\S]{0,300}(?:close|关闭)[^\n]*Issue/i,
  'an issue-backed merge must archive, comment, and close the issue');
requires(/branch[^\n]*(?:best[- ]effort|尽力)|(?:best[- ]effort|尽力)[^\n]*branch/i,
  'claim branch deletion must be best-effort cleanup');
requires(/(?:no Available Issue|没有可用 Issue|无可用 Issue)[^\n]*(?:stop|停止|结束)|(?:continue|继续)[^\n]*(?:select|选择)/i,
  'untargeted execution must continue selecting until exhausted');

console.log('lite skill contract tests passed');

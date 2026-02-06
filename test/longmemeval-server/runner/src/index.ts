#!/usr/bin/env bun
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { LongMemEvalRunner } from './runner.js';
import { parseLongMemEvalDataset, convertToTestSuite } from './converters/longmemeval.js';
import { LongMemEvalTestCaseSchema } from './types.js';

const USAGE = `
Usage: bun run index.ts [options]

Options:
  --dataset <path>         Path to LongMemEval JSON dataset file (required)
  --limit <n>             Limit to first N test cases (optional)
  --max-sessions <n>      Limit to first N sessions per test case (optional, useful for quick testing)
  --config-type <type>    Configuration type for report naming (baseline|fast-baseline|production-like|strict, default: longmemeval)
  --run-id <id>           Run identifier for user_id prefix (default: auto-generated timestamp YYMMDD-HHMMSS)
  --qa                     Enable QA accuracy evaluation (optional)
  --k-values <csv>         Comma-separated k values for Recall@k (default: 1,3,5,10)
  --no-delay              Disable realistic delay between sessions (default: enabled)
                           When enabled: first session no delay, subsequent sessions 12-20s delay
  --verbose                Verbose output
  --conversation-store     URL (default: http://localhost:26200)
  --temporal-store         URL (default: http://localhost:26405)
  --context-assembler      URL (default: http://localhost:26401)
  --llm-adapter            URL (default: http://localhost:26404)
  --output-dir <dir>       Output directory for reports (default: ../../test-data/reports/longmemeval)
  --format <format>        Report format: json, markdown, or both (default: both)
  --concurrency <num>      Max number of concurrent tests (default: 1)
  --help                   Show this help message
`;

async function main() {
    const args = process.argv.slice(2);
    const options = {
        datasetPath: undefined as string | undefined,
        limit: undefined as number | undefined,
        maxSessions: undefined as number | undefined,
        runId: undefined as string | undefined,
        enableQA: false,
        kValues: [1, 3, 5, 10] as number[],
        enableRealisticDelay: true,  // Default to true for realistic session pacing
        verbose: false,
        conversationStoreUrl: 'http://localhost:26200',
        temporalStoreUrl: 'http://localhost:26405',
        contextAssemblerUrl: 'http://localhost:26401',
        llmAdapterUrl: 'http://localhost:26404',
        configType: 'longmemeval',
        outputDir: 'test-data/reports/longmemeval',
        format: 'both' as 'json' | 'markdown' | 'both',
        concurrency: 1,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--verbose') options.verbose = true;
        else if (arg === '--qa') options.enableQA = true;
        else if (arg === '--realistic-delay') options.enableRealisticDelay = true;
        else if (arg === '--no-delay') options.enableRealisticDelay = false;
        else if (arg === '--dataset') options.datasetPath = args[++i];
        else if (arg === '--limit') options.limit = parseInt(args[++i], 10);
        else if (arg === '--max-sessions') options.maxSessions = parseInt(args[++i], 10);
        else if (arg === '--run-id') options.runId = args[++i];
        else if (arg === '--k-values') {
            const kValuesStr = args[++i];
            options.kValues = kValuesStr.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n));
        }
        else if (arg === '--conversation-store') options.conversationStoreUrl = args[++i];
        else if (arg === '--temporal-store') options.temporalStoreUrl = args[++i];
        else if (arg === '--context-assembler') options.contextAssemblerUrl = args[++i];
        else if (arg === '--llm-adapter') options.llmAdapterUrl = args[++i];
        else if (arg === '--config-type') options.configType = args[++i];
        else if (arg === '--output-dir') options.outputDir = args[++i];
        else if (arg === '--format') options.format = args[++i] as 'json' | 'markdown' | 'both';
        else if (arg === '--concurrency') options.concurrency = parseInt(args[++i], 10);
        else if (arg === '--help') {
            console.log(USAGE);
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${arg}`);
            console.log(USAGE);
            process.exit(1);
        }
    }

    if (!options.datasetPath) {
        console.error('Error: --dataset is required');
        console.log(USAGE);
        process.exit(1);
    }

    // Resolve paths relative to repo root
    const repoRoot = join(process.cwd(), '..', '..');
    const datasetPath = options.datasetPath.startsWith('/')
        ? options.datasetPath
        : join(repoRoot, options.datasetPath);
    
    // Use config type in output directory name if not explicitly set
    const outputDirBase = options.outputDir.startsWith('/')
        ? options.outputDir
        : join(repoRoot, options.outputDir);
    // Use the output directory as-is (don't replace 'longmemeval' with config type)
    const outputDir = outputDirBase;

    // Parse and convert dataset
    console.log('Parsing LongMemEval dataset...');
    const records = await parseLongMemEvalDataset(datasetPath);
    
    let recordsToUse = records;
    if (options.limit) {
        recordsToUse = records.slice(0, options.limit);
        console.log(`Limited to first ${options.limit} records (out of ${records.length})`);
    }

    console.log(`Converting ${recordsToUse.length} records to test suite...`);
    if (options.enableRealisticDelay) {
        console.log('Realistic delay enabled: first session no delay, subsequent sessions 12-20s delay');
    } else {
        console.log('Realistic delay disabled: all sessions injected immediately');
    }
    const testSuite = convertToTestSuite(recordsToUse, {
        enableQA: options.enableQA,
        kValues: options.kValues,
        runId: options.runId,  // Pass runId (undefined means auto-generate)
        enableRealisticDelay: options.enableRealisticDelay,
        maxSessions: options.maxSessions,
    });
    
    if (options.maxSessions) {
        console.log(`Limited to first ${options.maxSessions} sessions per test case`);
    }

    // Log the user prefix being used
    if (testSuite.length > 0) {
        const sampleUserId = testSuite[0].user_id;
        const userPrefix = sampleUserId.substring(0, sampleUserId.lastIndexOf('-'));
        console.log(`User prefix: ${userPrefix}`);
    }

    // Validate schema
    const validatedSuite = LongMemEvalTestCaseSchema.array().parse(testSuite);

    // Run evaluation
    const runner = new LongMemEvalRunner({
        conversationStoreUrl: options.conversationStoreUrl,
        temporalStoreUrl: options.temporalStoreUrl,
        contextAssemblerUrl: options.contextAssemblerUrl,
        llmAdapterUrl: options.llmAdapterUrl,
        verbose: options.verbose,
        concurrency: options.concurrency,
    });

    const suiteName = `longmemeval-${options.limit ? `limit${options.limit}` : 'full'}`;
    const result = await runner.runSuite(validatedSuite, suiteName);

    // Generate reports
    await mkdir(outputDir, { recursive: true });
    // Generate timestamp in format: YYYY-MM-DDTHH-MM-SS (local time, not UTC)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
    
    // Get git tag/version info
    let gitTag = 'unknown';
    try {
        const { execSync } = require('child_process');
        const repoRoot = join(process.cwd(), '..', '..');
        gitTag = execSync('git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo "no-tag"', { 
            encoding: 'utf-8',
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (e) {
        // Fallback if git command fails
        gitTag = 'unknown';
    }
    
    // Add metadata to result
    const resultWithMetadata = {
        ...result,
        metadata: {
            generated_at: new Date().toISOString(),
            git_tag: gitTag,
            config_type: options.configType,
            test_config: {
                dataset_path: datasetPath,
                limit: options.limit || null,
                max_sessions: options.maxSessions || null,
                k_values: options.kValues,
                enable_qa: options.enableQA,
                enable_realistic_delay: options.enableRealisticDelay,
                run_id: options.runId || null,
                concurrency: options.concurrency,
            },
            service_urls: {
                conversation_store: options.conversationStoreUrl,
                temporal_store: options.temporalStoreUrl,
                context_assembler: options.contextAssemblerUrl,
                llm_adapter: options.llmAdapterUrl,
            }
        }
    };
    
    if (options.format === 'json' || options.format === 'both') {
        const jsonPath = join(outputDir, `${options.configType}-report-${timestamp}.json`);
        await writeFile(jsonPath, JSON.stringify(resultWithMetadata, null, 2));
        console.log(`\n✓ JSON report saved: ${jsonPath}`);
    }
    
    if (options.format === 'markdown' || options.format === 'both') {
        const mdPath = join(outputDir, `${options.configType}-report-${timestamp}.md`);
        const markdown = generateMarkdownReport(resultWithMetadata, gitTag);
        await writeFile(mdPath, markdown);
        console.log(`✓ Markdown report saved: ${mdPath}`);
    }
}

function generateMarkdownReport(result: any, gitTag: string): string {
    let md = '# LongMemEval Evaluation Report\n\n';
    md += `Generated: ${result.metadata?.generated_at || new Date().toISOString()}\n`;
    md += `Git Tag: ${gitTag}\n`;
    md += `Config Type: ${result.metadata?.config_type || 'unknown'}\n\n`;
    
    // Test configuration
    if (result.metadata?.test_config) {
        md += `## Test Configuration\n\n`;
        const config = result.metadata.test_config;
        md += `- **Dataset**: ${config.dataset_path || 'unknown'}\n`;
        if (config.limit) md += `- **Limit**: ${config.limit} test cases\n`;
        if (config.max_sessions) md += `- **Max Sessions**: ${config.max_sessions} per test case\n`;
        md += `- **K Values**: ${config.k_values?.join(', ') || '1,3,5,10'}\n`;
        md += `- **QA Evaluation**: ${config.enable_qa ? 'Enabled' : 'Disabled'}\n`;
        md += `- **Realistic Delay**: ${config.enable_realistic_delay ? 'Enabled' : 'Disabled'}\n`;
        if (config.run_id) md += `- **Run ID**: ${config.run_id}\n`;
        md += `- **Concurrency**: ${config.concurrency || 1}\n\n`;
    }
    
    md += `## Suite: ${result.suite_name}\n\n`;
    md += `- **Total Cases**: ${result.total_cases}\n`;
    md += `- **Passed**: ${result.passed}\n`;
    md += `- **Failed**: ${result.failed}\n\n`;
    
    if (result.longmemeval_metrics) {
        md += `### LongMemEval Metrics\n\n`;
        
        if (result.longmemeval_metrics.retrieval) {
            md += `#### Retrieval Performance\n\n`;
            const recall = result.longmemeval_metrics.retrieval.recall_at_k;
            for (const [k, value] of Object.entries(recall).sort((a, b) => Number(a[0]) - Number(b[0]))) {
                md += `- Recall@${k}: ${(Number(value) * 100).toFixed(1)}% (${Number(value).toFixed(3)})\n`;
            }
            md += `- Total Cases: ${result.longmemeval_metrics.retrieval.total_questions}\n\n`;
        }
        
        if (result.longmemeval_metrics.qa) {
            md += `#### QA Accuracy\n\n`;
            md += `- Overall Accuracy: ${(result.longmemeval_metrics.qa.accuracy * 100).toFixed(1)}% (${result.longmemeval_metrics.qa.accuracy.toFixed(3)})\n`;
            md += `- Exact Match: ${result.longmemeval_metrics.qa.exact_match} / ${result.longmemeval_metrics.qa.total_questions} (${(result.longmemeval_metrics.qa.exact_match / result.longmemeval_metrics.qa.total_questions * 100).toFixed(1)}%)\n`;
            md += `- Total Questions: ${result.longmemeval_metrics.qa.total_questions}\n\n`;
        }
    }
    
    md += `### Test Cases\n\n`;
    for (const testCase of result.cases) {
        const status = testCase.passed ? '✅' : '❌';
        md += `#### ${status} ${testCase.test_case_id}\n\n`;
        md += `- **User ID**: ${testCase.user_id}\n`;
        md += `- **Duration**: ${testCase.duration_ms}ms\n`;
        if (testCase.processing_duration_ms !== undefined) {
            const processingMin = Math.floor(testCase.processing_duration_ms / 60000);
            const processingSec = Math.floor((testCase.processing_duration_ms % 60000) / 1000);
            md += `- **Processing Time**: ${processingMin}m${processingSec}s (${testCase.processing_duration_ms}ms) - from first ingest to queue empty\n`;
        }
        if (testCase.error) {
            md += `- **Error**: ${testCase.error}\n`;
        }
        md += `- **Steps**: ${testCase.steps.length}\n\n`;
        
        // Aggregate ingest steps and show summary
        const ingestSteps = testCase.steps.filter(s => s.action === 'ingest');
        const otherSteps = testCase.steps.filter(s => s.action !== 'ingest');
        const totalIngestTime = ingestSteps.reduce((sum, s) => sum + s.duration_ms, 0);
        
        if (ingestSteps.length > 0) {
            md += `  ✓ Ingest: ${ingestSteps.length} messages (${totalIngestTime}ms total)\n`;
        }
        
        for (const step of otherSteps) {
            const stepStatus = step.passed ? '✓' : '✗';
            md += `  ${stepStatus} Step ${step.step}: ${step.action} (${step.duration_ms}ms)\n`;
            if (step.error) {
                md += `    - Error: ${step.error}\n`;
            }
            if (step.longmemeval_metrics) {
                if (step.longmemeval_metrics.recall_at_k) {
                    const recalls = Object.entries(step.longmemeval_metrics.recall_at_k)
                        .map(([k, v]) => `Recall@${k}=${(Number(v) * 100).toFixed(1)}%`)
                        .join(', ');
                    md += `    - Retrieval: ${recalls}\n`;
                }
                if (step.longmemeval_metrics.qa_accuracy !== undefined) {
                    md += `    - QA Accuracy: ${(step.longmemeval_metrics.qa_accuracy * 100).toFixed(1)}%`;
                    if (step.longmemeval_metrics.qa_exact_match !== undefined) {
                        md += ` (Exact Match: ${step.longmemeval_metrics.qa_exact_match ? 'Yes' : 'No'})`;
                    }
                    md += `\n`;
                }
            }
        }
        md += '\n';
    }
    
    return md;
}

main().catch(console.error);

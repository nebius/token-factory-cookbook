class ModelBenchmark {
    // Constants for benchmark configuration
    static TEST_COUNT = 10;
    static TIMEOUT_MS = 100000; // 100 second timeout
    static PASS_RATE_THRESHOLD = 80;
    static NUM_UUIDS = 20;
    static TRIM_LOW_COUNT = 2;
    static TRIM_HIGH_COUNT = 2;

    constructor() {
        this.results = [];
        this.initModal();
        this.initSortButtons();
    }

    getDisplayName(modelId) {
        // Extract just the model name from paths like "openai/gpt-4" -> "gpt-4"
        return modelId.split('/').pop();
    }

    initSortButtons() {
        this.sortByNameBtn = document.getElementById('sort-by-name-btn');
        this.sortBySpeedBtn = document.getElementById('sort-by-speed-btn');

        if (this.sortByNameBtn) {
            this.sortByNameBtn.addEventListener('click', () => this.sortModelsByName());
        }

        if (this.sortBySpeedBtn) {
            this.sortBySpeedBtn.addEventListener('click', () => this.sortModelsBySpeed());
        }
    }

    sortModelsByName() {
        if (typeof availableModels === 'undefined' || availableModels.length === 0) {
            console.warn('❌ No models available to sort');
            return;
        }

        console.log('🔄 Sorting models by name (alphabetical)');

        // Sort availableModels alphabetically by id
        availableModels.sort((a, b) => a.id.localeCompare(b.id));

        // Re-populate both dropdowns
        const player1ModelOptions = document.getElementById('player1-model-options');
        const player2ModelOptions = document.getElementById('player2-model-options');

        if (player1ModelOptions) populateSearchableDropdown(player1ModelOptions, availableModels, 'player1');
        if (player2ModelOptions) populateSearchableDropdown(player2ModelOptions, availableModels, 'player2');

        console.log('✅ Models sorted by name successfully');
    }

    sortModelsBySpeed() {
        if (typeof availableModels === 'undefined' || availableModels.length === 0) {
            console.warn('❌ No models available to sort');
            return;
        }

        if (this.results.length === 0) {
            console.warn('❌ No benchmark results available. Run a speed test first.');
            return;
        }

        console.log('🔄 Sorting models by speed (≥80% pass rate first)');

        // Sort availableModels based on benchmark results with 80% pass rate threshold
        availableModels.sort((a, b) => {
            const resultA = this.results.find(r => r.model === a.id);
            const resultB = this.results.find(r => r.model === b.id);

            const latencyA = resultA ? parseFloat(resultA.medianLatency) : Infinity;
            const latencyB = resultB ? parseFloat(resultB.medianLatency) : Infinity;
            const successRateA = resultA ? parseFloat(resultA.successRate) : 0;
            const successRateB = resultB ? parseFloat(resultB.successRate) : 0;

            // Failed models (below 80%) go to the end
            const aFailed = successRateA < ModelBenchmark.PASS_RATE_THRESHOLD;
            const bFailed = successRateB < ModelBenchmark.PASS_RATE_THRESHOLD;

            if (aFailed && !bFailed) return 1;  // a failed, b passed -> a after b
            if (!aFailed && bFailed) return -1; // a passed, b failed -> a before b
            if (aFailed && bFailed) {
                // Both failed: sort by success rate (highest first)
                return successRateB - successRateA;
            }

            // Both passed: sort by speed (fastest first)
            return latencyA - latencyB;
        });

        // Re-populate both dropdowns
        const player1ModelOptions = document.getElementById('player1-model-options');
        const player2ModelOptions = document.getElementById('player2-model-options');

        if (player1ModelOptions) populateSearchableDropdown(player1ModelOptions, availableModels, 'player1');
        if (player2ModelOptions) populateSearchableDropdown(player2ModelOptions, availableModels, 'player2');

        console.log('✅ Models sorted by speed successfully');
    }

    updateSortButtonState() {
        if (this.sortBySpeedBtn) {
            if (this.results.length > 0) {
                this.sortBySpeedBtn.classList.remove('btn-disabled');
                this.sortBySpeedBtn.title = 'Sort models by speed (fastest to slowest)';
            } else {
                this.sortBySpeedBtn.classList.add('btn-disabled');
                this.sortBySpeedBtn.title = 'Sort models by speed (run benchmark first)';
            }
        }

        // Also update show results button state
        if (this.showResultsBtn) {
            if (this.results.length > 0) {
                this.showResultsBtn.classList.remove('btn-disabled');
                this.showResultsBtn.title = 'Show benchmark results';
            } else {
                this.showResultsBtn.classList.add('btn-disabled');
                this.showResultsBtn.title = 'Show results (run benchmark first)';
            }
        }
    }

    stopBenchmarkTimer() {
        if (this.benchmarkTimer) {
            clearInterval(this.benchmarkTimer);
            this.benchmarkTimer = null;
        }
        // Final time calculation with null check
        if (this.benchmarkStartTime) {
            this.benchmarkElapsedTime = Math.floor((Date.now() - this.benchmarkStartTime) / 1000);
        }
    }

    formatBenchmarkTime(seconds) {
        if (seconds < 60) {
            return `${seconds}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const remainingSeconds = seconds % 60;
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        }
    }

    initModal() {
        // Get modal elements
        this.modal = document.getElementById('benchmark-modal');
        this.showResultsBtn = document.getElementById('show-results-btn');
        this.closeModalBtn = document.getElementById('close-modal-btn');
        this.resultsContainer = document.getElementById('benchmark-results-container');

        if (this.showResultsBtn && this.modal) {
            this.showResultsBtn.addEventListener('click', () => this.showResultsInModal());
        }

        if (this.closeModalBtn && this.modal) {
            this.closeModalBtn.addEventListener('click', () => this.hideModal());
        }

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.hideModal();
            }
        });
    }

    showResultsInModal() {
        if (!this.resultsContainer || !this.modal) return;

        if (this.results.length === 0) {
            this.resultsContainer.innerHTML = `
                <div class="benchmark-no-results">
                    <p>📊 No benchmark results available</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">Run the benchmark first by clicking "Benchmark Models"</p>
                </div>
            `;
            this.modal.classList.remove('hidden');
            return;
        }

        // Split results into pass/fail based on 80% threshold
        const passedResults = this.results.filter(r => parseFloat(r.successRate) >= ModelBenchmark.PASS_RATE_THRESHOLD);
        const failedResults = this.results.filter(r => parseFloat(r.successRate) < ModelBenchmark.PASS_RATE_THRESHOLD);

        // Sort passed results by median latency (fastest to slowest)
        const sortedPassed = [...passedResults].sort((a, b) =>
            parseFloat(a.medianLatency) - parseFloat(b.medianLatency)
        );

        // Sort failed results by success rate (highest first)
        const sortedFailed = [...failedResults].sort((a, b) =>
            parseFloat(b.successRate) - parseFloat(a.successRate)
        );

        // Combine: passed first (by speed), failed last (by accuracy)
        const sortedResults = [...sortedPassed, ...sortedFailed];

        // Generate the table
        const totalPassed = passedResults.length;
        const totalFailed = failedResults.length;

        let tableHTML = `
            <div class="benchmark-results-table-wrapper">
                <div class="benchmark-summary">
                    <div class="benchmark-summary-line">
                        models tested: ${sortedResults.length}, time taken: ${this.formatBenchmarkTime(this.benchmarkElapsedTime)}, passed (≥80%): ${totalPassed}, failed: ${totalFailed}
                    </div>
                </div>
                <table class="benchmark-results-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Model</th>
                            <th>Median</th>
                            <th>Avg</th>
                            <th>Min</th>
                            <th>Max</th>
                            <th>Success Rate</th>
                            <th>Requests</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        sortedResults.forEach((result, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
            const rank = `${medal} ${index + 1}`;
            const successRate = parseFloat(result.successRate);
            const failed = successRate < 80;

            // Color code latency (use median for color coding)
            let latencyClass = 'benchmark-latency-positive';
            const medianLatency = parseFloat(result.medianLatency);
            if (medianLatency > 500) {
                latencyClass = 'benchmark-latency-critical';
            } else if (medianLatency > 300) {
                latencyClass = 'benchmark-latency-warning';
            }

            // Color code success rate
            let successClass = 'benchmark-success-high';
            if (failed) {
                successClass = 'benchmark-success-low';
            } else if (successRate < 100) {
                successClass = 'benchmark-success-medium';
            }

            tableHTML += `
                <tr>
                    <td><span class="benchmark-rank">${rank}</span></td>
                    <td class="benchmark-model-cell">${this.getDisplayName(result.model)}</td>
                    <td class="${latencyClass}">${this.formatNumber(result.medianLatency)}ms</td>
                    <td>${this.formatNumber(result.averageLatency)}ms</td>
                    <td>${this.formatNumber(result.minLatency)}ms</td>
                    <td>${this.formatNumber(result.maxLatency)}ms</td>
                    <td class="${successClass}">${result.successRate}%</td>
                    <td>${result.successfulRequests}/${result.totalRequests}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        this.resultsContainer.innerHTML = tableHTML;
        this.modal.classList.remove('hidden');
    }

    hideModal() {
        if (this.modal) {
            this.modal.classList.add('hidden');
        }
    }

    async benchmarkModel(apiUrl, apiKey, modelName, testCount = ModelBenchmark.TEST_COUNT, thinkingEnabled = false) {
        console.log(`\n🚀 Starting benchmark for model: ${this.getDisplayName(modelName)}`);
        console.log(`   Running ${ModelBenchmark.TEST_COUNT} parallel test requests...`);

        const results = [];
        const requests = Array.from({ length: testCount }, (_, i) =>
            this.performUUIDRequest(apiUrl, apiKey, modelName, i, thinkingEnabled)
        );

        const requestResults = await Promise.all(requests);

        // Process results and collect successful ones with correct answers
        if (!requestResults || !Array.isArray(requestResults)) {
            console.log(`   ❌ Invalid request results for ${modelName}`);
            return null;
        }

        requestResults.forEach((result, index) => {
            if (!result || typeof result.success !== 'boolean') {
                console.warn(`   ⚠️  Request ${index + 1} has invalid result structure`);
                return;
            }

            if (result.success) {
                results.push({
                    latency: result.latency,
                    correct: result.correct,
                    line: index + 1
                });
                if (!result.correct) {
                    console.warn(`   ⚠️  Request ${index + 1} returned wrong answer`);
                }
            } else {
                console.warn(`   ⚠️  Request ${index + 1} failed: ${result.error}`);
            }
        });

        if (results.length === 0) {
            console.log(`   ❌ No successful requests for ${modelName}`);
            return null;
        }

        // Drop lowest 2 and highest 2 latencies, use remaining 6
        const trimmedLatencies = this.trimOutliers(results.map(r => r.latency));

        if (trimmedLatencies.length === 0) {
            console.log(`   ❌ Not enough successful requests for trimmed calculation`);
            return null;
        }

        // Calculate stats on trimmed results
        const avgLatency = trimmedLatencies.reduce((a, b) => a + b, 0) / trimmedLatencies.length;
        const minLatency = Math.min(...trimmedLatencies);
        const maxLatency = Math.max(...trimmedLatencies);
        const medianLatency = this.calculateMedian(trimmedLatencies);

        // Count correct answers from all successful requests
        const correctCount = results.filter(r => r.correct).length;
        const successRate = (correctCount / results.length) * 100;

        const result = {
            model: modelName,
            averageLatency: avgLatency.toFixed(2),
            medianLatency: medianLatency.toFixed(2),
            minLatency: minLatency.toFixed(2),
            maxLatency: maxLatency.toFixed(2),
            successRate: successRate.toFixed(1),
            correctAnswers: correctCount,
            successfulRequests: results.length,
            totalRequests: testCount,
            allLatencies: trimmedLatencies.map(l => l.toFixed(2))
        };

        const passed = successRate >= ModelBenchmark.PASS_RATE_THRESHOLD;
        const passStatus = passed ? '✅ PASS' : '❌ FAIL';

        console.log(`   ✅ Complete: ${results.length}/${ModelBenchmark.TEST_COUNT} successful requests (${correctCount} correct)`);
        console.log(`   ${passStatus} - Success Rate: ${result.successRate}% ${passed ? '(≥80% threshold)' : '(<80% threshold)'}`);
        console.log(`   📊 Statistics (trimmed ${ModelBenchmark.TEST_COUNT}→${trimmedLatencies}): Median: ${result.medianLatency}ms | Avg: ${result.averageLatency}ms | Min: ${result.minLatency}ms | Max: ${result.maxLatency}ms`);

        this.results.push(result);
        return result;
    }

    async performUUIDRequest(apiUrl, apiKey, modelName, index, thinkingEnabled = false) {
        try {
            // Fallback for crypto.randomUUID() in older browsers
            const generateUUID = () => {
                if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                    return crypto.randomUUID();
                }
                // Fallback implementation
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            };

            // Generate 20 random UUID strings
            const uuids = Array.from({ length: ModelBenchmark.NUM_UUIDS }, () => generateUUID());
            const targetLine = Math.floor(Math.random() * 10) + 5; // Random line between 5-14

            const systemPrompt = `You are a helpful assistant. I will give you 20 lines, each containing a random string. Your task is to return ONLY the string on line ${targetLine}. Do not include any other text, explanation, or line numbers - just the exact string on that line.`;

            // Build the UUID list as numbered lines
            const uuidList = uuids.map((uuid, i) => `${i + 1}. ${uuid}`).join('\n');
            const userPrompt = `Here are the strings:\n\n${uuidList}\n\nReturn the string on line ${targetLine}:`;

            const startTime = performance.now();

            // Create a timeout promise that resolves after timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Request timeout after ${ModelBenchmark.TIMEOUT_MS/1000} seconds`)), ModelBenchmark.TIMEOUT_MS);
            });

            // Race between the actual fetch and the timeout
            try {
                const response = await Promise.race([
                    fetch(`${apiUrl}chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: modelName,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: userPrompt }
                            ],
                            temperature: 0.1,
                            // Respect the UI "Model Reasoning" toggle so speed
                            // tests can compare thinking on vs off.
                            chat_template_kwargs: {
                                enable_thinking: thinkingEnabled
                            }
                        })
                    }),
                    timeoutPromise
                ]);

                const endTime = performance.now();
                const latency = endTime - startTime;

                // Validate response structure (it could be from timeout)
                if (!response || typeof response.ok !== 'boolean') {
                    throw new Error('Invalid response after timeout');
                }

                if (!response.ok) {
                    return {
                        success: false,
                        latency: latency,
                        correct: false,
                        error: `HTTP ${response.status}`
                    };
                }

                const data = await response.json();
                const modelResponse = data.choices?.[0]?.message?.content?.trim() || '';

                // Check if the response matches the target UUID
                const targetUUID = uuids[targetLine - 1];
                const correct = modelResponse === targetUUID;

                return {
                    success: true,
                    latency: latency,
                    correct: correct,
                    targetLine: targetLine
                };
            } catch (raceError) {
                // Handle Promise.race errors
                return {
                    success: false,
                    latency: null,
                    correct: false,
                    error: raceError.message || 'Request failed or timed out'
                };
            }
        } catch (error) {
            return {
                success: false,
                latency: null,
                correct: false,
                error: error.message
            };
        }
    }

    calculateMedian(latencies) {
        if (latencies.length === 0) return 0;

        const sorted = [...latencies].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
        } else {
            return sorted[middle];
        }
    }

    formatNumber(num, decimals = 0) {
        return Number(num).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    trimOutliers(latencies) {
        // Filter out null/undefined latencies first
        const validLatencies = latencies.filter(l => l !== null && !isNaN(l));

        if (validLatencies.length === 0) {
            return [];
        }

        // Sort and trim outliers
        return validLatencies.sort((a, b) => a - b)
            .slice(ModelBenchmark.TRIM_LOW_COUNT, validLatencies.length - ModelBenchmark.TRIM_HIGH_COUNT);
    }

    printResults() {
        console.log('\n📊 BENCHMARK RESULTS');
        console.log('='.repeat(130));

        if (this.results.length === 0) {
            console.log('No benchmark results available.');
            return;
        }

        // Split results into pass/fail based on 80% threshold
        const passedResults = this.results.filter(r => parseFloat(r.successRate) >= ModelBenchmark.PASS_RATE_THRESHOLD);
        const failedResults = this.results.filter(r => parseFloat(r.successRate) < ModelBenchmark.PASS_RATE_THRESHOLD);

        // Sort passed results by median latency (fastest to slowest)
        const sortedPassed = [...passedResults].sort((a, b) =>
            parseFloat(a.medianLatency) - parseFloat(b.medianLatency)
        );

        // Sort failed results by success rate (highest first)
        const sortedFailed = [...failedResults].sort((a, b) =>
            parseFloat(b.successRate) - parseFloat(a.successRate)
        );

        // Combine: passed first (by speed), failed last (by accuracy)
        const sortedResults = [...sortedPassed, ...sortedFailed];

        console.log('\n🏆 MODEL PERFORMANCE RANKING (≥80% Pass Rate by Speed, Below 80% by Accuracy)');
        console.log('─'.repeat(130));

        // Create table header
        const header = ['Rank', 'Model', 'Median', 'Avg', 'Min', 'Max', 'Success Rate', 'Requests'];
        const colWidths = [6, 40, 12, 12, 10, 10, 15, 12];

        // Print header
        console.log(
            header.map((h, i) => h.padEnd(colWidths[i])).join('|').trim()
        );
        console.log('─'.repeat(130).replace(/─/g, '─'));

        // Print each model as a row
        sortedResults.forEach((result, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
            const rank = `${medal} ${index + 1}`;
            const displayName = this.getDisplayName(result.model);
            const model = displayName.length > 37 ? displayName.substring(0, 37) + '...' : displayName;
            const median = `${this.formatNumber(result.medianLatency)}ms`;
            const avg = `${this.formatNumber(result.averageLatency)}ms`;
            const min = `${this.formatNumber(result.minLatency)}ms`;
            const max = `${this.formatNumber(result.maxLatency)}ms`;
            const success = `${result.successRate}%`;
            const requests = `${result.successfulRequests}/${result.totalRequests}`;

            console.log(
                rank.padEnd(colWidths[0]) +
                model.padEnd(colWidths[1]) +
                median.padEnd(colWidths[2]) +
                avg.padEnd(colWidths[3]) +
                min.padEnd(colWidths[4]) +
                max.padEnd(colWidths[5]) +
                success.padEnd(colWidths[6]) +
                requests.padEnd(colWidths[7])
            );
        });

        console.log('\n📋 DETAILED RESULTS');
        console.log('─'.repeat(130));

        this.results.forEach((result, index) => {
            console.log(`\n${index + 1}. Model: ${this.getDisplayName(result.model)}`);
            console.log(`   Median Latency: ${this.formatNumber(result.medianLatency)}ms`);
            console.log(`   Average Latency: ${this.formatNumber(result.averageLatency)}ms`);
            console.log(`   Min Latency: ${this.formatNumber(result.minLatency)}ms`);
            console.log(`   Max Latency: ${this.formatNumber(result.maxLatency)}ms`);
            console.log(`   Success Rate: ${result.successRate}% (${result.successfulRequests}/${result.totalRequests})`);
            console.log(`   All Latencies: [${result.allLatencies.map(l => this.formatNumber(l)).join(', ')}]ms`);
        });

        console.log('\n' + '='.repeat(130));
    }

    clearResults() {
        this.results = [];
        this.updateSortButtonState();
        console.log('🧹 Benchmark results cleared.');
    }

    startBenchmarkTimer() {
        const benchmarkBtn = document.getElementById('benchmark-btn');
        if (!benchmarkBtn) return;

        this.benchmarkStartTime = Date.now();
        this.benchmarkElapsedTime = 0;

        this.benchmarkTimer = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.benchmarkStartTime) / 1000);
            this.benchmarkElapsedTime = elapsedSeconds;
            benchmarkBtn.textContent = `⏳ Running test (${elapsedSeconds}s)`;
        }, 1000);
    }
}

// Global benchmark instance
const benchmark = new ModelBenchmark();

// Benchmark button functionality
document.addEventListener('DOMContentLoaded', () => {
    const benchmarkBtn = document.getElementById('benchmark-btn');

    if (benchmarkBtn) {
        benchmarkBtn.addEventListener('click', async () => {
            // Disable button immediately
            benchmarkBtn.disabled = true;

            const apiUrl = document.getElementById('api-url').value;
            const apiKey = document.getElementById('api-key').value;
            // Mirror the Options toggle so speed tests compare the same setting used in-game
            const thinkingEnabled = document.getElementById('thinking-mode-checkbox')?.checked ?? false;

            if (!apiUrl || !apiKey) {
                console.error('❌ Please provide API URL and API key');
                alert('Please provide API URL and API key');
                benchmarkBtn.disabled = false;
                return;
            }

            // Access availableModels from game.js
            if (typeof availableModels === 'undefined' || availableModels.length === 0) {
                console.error('❌ No models loaded. Please load models first.');
                alert('Please load models first by clicking "Load Models"');
                benchmarkBtn.disabled = false;
                return;
            }

            benchmark.startBenchmarkTimer();
            benchmark.clearResults();
            // Ensure sort by speed and show results buttons are initially disabled during benchmark
            if (benchmark.sortBySpeedBtn) {
                benchmark.sortBySpeedBtn.classList.add('btn-disabled');
            }
            if (benchmark.showResultsBtn) {
                benchmark.showResultsBtn.classList.add('btn-disabled');
            }

            console.log('\n🚀 Starting parallel benchmark for ALL loaded models');
            console.log(`   Found ${availableModels.length} models to benchmark`);
            console.log(`   Running 10 parallel test requests per model...`);

            try {
                // Benchmark all models in parallel
                const benchmarkPromises = availableModels.map(model =>
                    benchmark.benchmarkModel(apiUrl, apiKey, model.id, 10, thinkingEnabled)
                );

                await Promise.allSettled(benchmarkPromises);
                benchmark.printResults();
                // Enable sort by speed button only after benchmark completes
                benchmark.updateSortButtonState();
                // Automatically show results popup after benchmark completes
                benchmark.showResultsInModal();
            } catch (error) {
                console.error('❌ Benchmark error:', error);
            } finally {
                benchmark.stopBenchmarkTimer();
                benchmarkBtn.disabled = false;
                benchmarkBtn.textContent = '⚡ Run Speed Test';
            }
        });
    }
});
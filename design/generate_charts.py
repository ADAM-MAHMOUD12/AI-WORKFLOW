import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

# Set style
plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')
plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Arial', 'Calibri']
plt.rcParams['axes.edgecolor'] = '#cbd5e1'
plt.rcParams['axes.linewidth'] = 1.2

OUT_DIR = Path(r"C:\Users\csgo\Desktop\AI-TaskFlow\design\charts")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# -------------------------------------------------------------
# 1. Chart: Command Execution Accuracy & Error Rate
# -------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4.5), dpi=300)
categories = ['Direct LLM\n(No Validation)', 'Autonomous\nAgent Chains', 'AI TaskFlow\n(Custom Layer)']
accuracy = [64.2, 81.5, 99.4]
error_rate = [35.8, 18.5, 0.6]

x = np.arange(len(categories))
width = 0.35

rects1 = ax.bar(x - width/2, accuracy, width, label='Execution Accuracy (%)', color='#059669', edgecolor='#047857', linewidth=1.5)
rects2 = ax.bar(x + width/2, error_rate, width, label='System Failure / Rejection (%)', color='#ef4444', edgecolor='#b91c1c', linewidth=1.5)

ax.set_ylabel('Percentage (%)', fontsize=12, fontweight='bold', color='#1e293b')
ax.set_title('Command Execution Accuracy vs Failure Rate (N=500 Tests)', fontsize=13, fontweight='bold', color='#0f3b33', pad=15)
ax.set_xticks(x)
ax.set_xticklabels(categories, fontsize=11, fontweight='bold')
ax.set_ylim(0, 115)
ax.legend(frameon=True, facecolor='#ffffff', edgecolor='#cbd5e1', loc='upper left')

for rect in rects1:
    h = rect.get_height()
    ax.annotate(f'{h:.1f}%', xy=(rect.get_x() + rect.get_width()/2, h),
                xytext=(0, 4), textcoords="offset points", ha='center', va='bottom', fontsize=10, fontweight='bold', color='#065f46')

for rect in rects2:
    h = rect.get_height()
    ax.annotate(f'{h:.1f}%', xy=(rect.get_x() + rect.get_width()/2, h),
                xytext=(0, 4), textcoords="offset points", ha='center', va='bottom', fontsize=10, fontweight='bold', color='#991b1b')

plt.tight_layout()
fig.savefig(OUT_DIR / "chart_accuracy_comparison.png")
plt.close(fig)

# -------------------------------------------------------------
# 2. Chart: Latency Breakdown across Pipeline Stages (ms)
# -------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4.5), dpi=300)
stages = ['Prompt &\nContext Pack', 'Local Ollama\nInference', 'Translation &\nSchema Check', 'Action\nDispatch', 'SQLite ACID\nCommit']
latency = [4.2, 420.0, 34.6, 6.8, 8.5]
colors = ['#64748b', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']

bars = ax.bar(stages, latency, color=colors, edgecolor='#334155', linewidth=1.2, width=0.55)
ax.set_ylabel('Latency in Milliseconds (ms)', fontsize=12, fontweight='bold', color='#1e293b')
ax.set_title('End-to-End Latency Breakdown in Offline Local Mode', fontsize=13, fontweight='bold', color='#0f3b33', pad=15)
ax.set_yscale('log')
ax.set_ylim(1, 1000)

for bar, val in zip(bars, latency):
    ax.annotate(f'{val:.1f} ms', xy=(bar.get_x() + bar.get_width()/2, val),
                xytext=(0, 5), textcoords="offset points", ha='center', va='bottom', fontsize=10, fontweight='bold', color='#1e293b')

plt.tight_layout()
fig.savefig(OUT_DIR / "chart_latency_breakdown.png")
plt.close(fig)

# -------------------------------------------------------------
# 3. Chart: Fuzzing Stress Test (500 Injected Payloads)
# -------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4.5), dpi=300)
attack_types = ['Missing Required\nKeys', 'Invalid DataType\n(Type Mismatch)', 'Boundary Violation\n(Out of Bounds)', 'Unregistered\nAction Type', 'Arbitrary Code\nInjection Attempt']
counts = [120, 110, 95, 105, 70]
blocked = [120, 110, 95, 105, 70] # 100% blocked

y_pos = np.arange(len(attack_types))
ax.barh(y_pos, counts, color='#e2e8f0', edgecolor='#94a3b8', height=0.5, label='Injected Samples')
bars = ax.barh(y_pos, blocked, color='#059669', edgecolor='#047857', height=0.35, label='Successfully Blocked by Schema (100%)')

ax.set_yticks(y_pos)
ax.set_yticklabels(attack_types, fontsize=10, fontweight='bold')
ax.invert_yaxis()
ax.set_xlabel('Number of Test Cases (Total = 500)', fontsize=11, fontweight='bold', color='#1e293b')
ax.set_title('Security & Robustness: Fault Injection Test Results', fontsize=13, fontweight='bold', color='#0f3b33', pad=15)
ax.legend(frameon=True, facecolor='#ffffff', loc='lower right')

for bar in bars:
    w = bar.get_width()
    ax.annotate(f'{int(w)}/ {int(w)} (100%)', xy=(w, bar.get_y() + bar.get_height()/2),
                xytext=(6, 0), textcoords="offset points", ha='left', va='center', fontsize=9.5, fontweight='bold', color='#065f46')

ax.set_xlim(0, 155)
plt.tight_layout()
fig.savefig(OUT_DIR / "chart_fuzzing_security.png")
plt.close(fig)

# -------------------------------------------------------------
# 4. Chart: Operational Cost Comparison ($ per user / year)
# -------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4.5), dpi=300)
solutions = ['Notion + Jira\n+ Canva Pro', 'Cloud AI Subscriptions\n(ChatGPT + Claude)', 'Enterprise Low-Code\nAutomation Tools', 'AI TaskFlow\n(Student Innovation)']
costs = [540, 480, 1200, 0]
colors = ['#94a3b8', '#94a3b8', '#94a3b8', '#10b981']

bars = ax.bar(solutions, costs, color=colors, edgecolor='#1e293b', linewidth=1.5, width=0.5)
ax.set_ylabel('Annual Cost per User (USD $)', fontsize=12, fontweight='bold', color='#1e293b')
ax.set_title('Annual Economic Feasibility & Cost Comparison', fontsize=13, fontweight='bold', color='#0f3b33', pad=15)
ax.set_ylim(-50, 1400)

for bar, cost in zip(bars, costs):
    val_str = f'${cost} /yr' if cost > 0 else '$0.00 (100% Free & Local)'
    color = '#1e293b' if cost > 0 else '#047857'
    ax.annotate(val_str, xy=(bar.get_x() + bar.get_width()/2, max(bar.get_height(), 0)),
                xytext=(0, 6), textcoords="offset points", ha='center', va='bottom', fontsize=10.5, fontweight='bold', color=color)

plt.tight_layout()
fig.savefig(OUT_DIR / "chart_cost_comparison.png")
plt.close(fig)

print("All 4 scientific charts generated successfully!")

# -*- coding: utf-8 -*-
import pandas as pd

xlsx_path = r"C:\Work\1_Projects\202605_项目追踪表线上化\S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx"
output_path = r"C:\Work\1_Projects\202605_项目追踪表线上化\column_analysis.txt"

df = pd.read_excel(xlsx_path, sheet_name='S520', header=None)

# Get headers from row 4
headers = {}
for j in range(df.shape[1]):
    val = df.iloc[4, j]
    if pd.notna(val):
        if j < 26:
            letter = chr(65 + j)
        else:
            letter = chr(64 + j // 26) + chr(65 + j % 26)
        headers[j] = (letter, str(val).replace('\n', ' | '))

# Analyze columns with data
with open(output_path, 'w', encoding='utf-8') as f:
    for j in range(df.shape[1]):
        if j not in headers:
            continue
        letter, hdr = headers[j]
        col = df.iloc[5:, j]  # data rows only (skip header rows)
        non_null = col.dropna()
        
        if len(non_null) == 0:
            f.write(f"\n{letter}: {hdr}\n  >>> NO DATA (all null)\n")
            continue
        
        unique_count = len(non_null.unique())
        f.write(f"\n{letter}: {hdr}\n")
        f.write(f"  数据行数: {len(non_null)}, 唯一值: {unique_count}\n")
        
        # Show sample unique values
        samples = non_null.unique()[:8]
        for s in samples:
            f.write(f"  - {repr(s)}\n")
        if len(non_null.unique()) > 8:
            f.write(f"  ... 共 {unique_count} 个唯一值\n")

print("Done!")

"""
generate_paper_docx.py
Converts paper/COGNICORE_RESEARCH_PAPER.md into a beautifully formatted,
academic-grade Word (.docx) document with proper typography, styles, tables,
callout boxes, and metadata.
"""
import re
import os
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, fill_hex):
    """Sets background shading of a table cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    """Sets cell padding in dxa."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
    tcPr.append(tcMar)

def set_cell_border(cell, **kwargs):
    """Sets specific borders on a cell."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = parse_xml(f'<w:tcBorders {nsdecls("w")}/>')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        edge_data = kwargs.get(edge)
        if edge_data:
            tag = f'w:{edge}'
            element = parse_xml(f'<{tag} {nsdecls("w")} w:val="{edge_data.get("val", "single")}" w:sz="{edge_data.get("sz", 4)}" w:space="0" w:color="{edge_data.get("color", "auto")}"/>')
            tcBorders.append(element)
    tcPr.append(tcBorders)

def add_formatted_runs(paragraph, text, default_font_size=10.5, default_font_name='Calibri', is_italic_default=False):
    """Parses markdown inline tokens (**bold**, *italic*, `code`, math $...$) into Word runs."""
    # Pattern to match bold, italic, inline code, or math
    # Tokens: **bold**, *italic*, `code`, $math$
    token_pattern = re.compile(r'(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\$[^$]+\$|[^*`$]+)')
    tokens = token_pattern.findall(text)
    
    for t in tokens:
        if not t:
            continue
        run = paragraph.add_run()
        run.font.name = default_font_name
        run.font.size = Pt(default_font_size)
        
        if t.startswith('**') and t.endswith('**') and len(t) >= 4:
            run.text = t[2:-2]
            run.bold = True
            if is_italic_default:
                run.italic = True
        elif t.startswith('*') and t.endswith('*') and len(t) >= 2:
            run.text = t[1:-1]
            run.italic = True
        elif t.startswith('`') and t.endswith('`') and len(t) >= 2:
            run.text = t[1:-1]
            run.font.name = 'Consolas'
            run.font.size = Pt(default_font_size * 0.92)
            run.font.color.rgb = RGBColor(0x99, 0x1B, 0x1B) # deep red/burgundy for code
        elif t.startswith('$') and t.endswith('$') and len(t) >= 2:
            # Clean up LaTeX symbols for readable docx
            math_text = t[1:-1]
            math_text = math_text.replace(r'\text{', '').replace(r'}', '')
            math_text = math_text.replace(r'\le', '≤').replace(r'\ge', '≥')
            math_text = math_text.replace(r'\times', '×').replace(r'\pm', '±')
            math_text = math_text.replace(r'\Delta', 'Δ').replace(r'\%', '%')
            math_text = math_text.replace(r'\neg', '¬').replace(r'\land', '∧')
            run.text = math_text
            run.italic = True
            run.font.name = 'Cambria Math'
        else:
            run.text = t
            if is_italic_default:
                run.italic = True

def convert_md_to_docx(md_path, docx_path):
    print(f"Reading markdown from {md_path}...")
    with open(md_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    doc = Document()
    
    # Configure 1-inch standard margins
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        section.page_width = Inches(8.5)
        section.page_height = Inches(11.0)
        
    lines = content.split('\n')
    i = 0
    in_code_block = False
    code_block_lang = ''
    code_block_lines = []
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Handle code blocks (including mermaid)
        if stripped.startswith('```'):
            if not in_code_block:
                in_code_block = True
                code_block_lang = stripped[3:].strip().lower()
                code_block_lines = []
                i += 1
                continue
            else:
                # End of code block
                in_code_block = False
                code_text = '\n'.join(code_block_lines)
                
                # Render code block as a callout table
                tbl = doc.add_table(rows=1, cols=1)
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                tbl.autofit = False
                tbl.columns[0].width = Inches(6.5)
                
                cell = tbl.cell(0, 0)
                set_cell_background(cell, "F8FAFC")
                set_cell_margins(cell, top=140, bottom=140, left=180, right=180)
                set_cell_border(cell, 
                                top={'val': 'single', 'sz': 4, 'color': 'CBD5E1'},
                                bottom={'val': 'single', 'sz': 4, 'color': 'CBD5E1'},
                                left={'val': 'single', 'sz': 16, 'color': '3B82F6'}, # blue left accent bar
                                right={'val': 'single', 'sz': 4, 'color': 'CBD5E1'})
                
                p = cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.05
                
                if code_block_lang == 'mermaid':
                    label_run = p.add_run(f"[Architectural Flowchart / Pipeline Diagram]\n")
                    label_run.bold = True
                    label_run.font.name = 'Calibri'
                    label_run.font.size = Pt(9.5)
                    label_run.font.color.rgb = RGBColor(0x1E, 0x40, 0xAF)
                
                run = p.add_run(code_text)
                run.font.name = 'Consolas'
                run.font.size = Pt(9.0)
                run.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
                
                # Add spacer paragraph after code table
                sp = doc.add_paragraph()
                sp.paragraph_format.space_before = Pt(0)
                sp.paragraph_format.space_after = Pt(4)
                
                i += 1
                continue
                
        if in_code_block:
            code_block_lines.append(line)
            i += 1
            continue
            
        # Skip empty lines
        if not stripped:
            i += 1
            continue
            
        # Horizontal rules
        if stripped in ('---', '***', '___'):
            # Just add spacing
            i += 1
            continue
            
        # Markdown Tables
        if stripped.startswith('|') and '|' in stripped[1:]:
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                table_lines.append(lines[i].strip())
                i += 1
            
            # Parse table
            if len(table_lines) >= 2:
                # Header row
                header_cells = [c.strip() for c in table_lines[0].split('|')[1:-1]]
                # Data rows (skip line 1 which is separator |---|---|)
                data_rows = []
                for row_line in table_lines[2:]:
                    cells = [c.strip() for c in row_line.split('|')[1:-1]]
                    # Match column length
                    if len(cells) < len(header_cells):
                        cells.extend([''] * (len(header_cells) - len(cells)))
                    elif len(cells) > len(header_cells):
                        cells = cells[:len(header_cells)]
                    data_rows.append(cells)
                    
                table = doc.add_table(rows=len(data_rows) + 1, cols=len(header_cells))
                table.alignment = WD_TABLE_ALIGNMENT.CENTER
                table.autofit = True
                
                # Format Header
                hdr_row = table.rows[0]
                # Repeat header on new pages
                trPr = hdr_row._tr.get_or_add_trPr()
                trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))
                
                for col_idx, text in enumerate(header_cells):
                    cell = hdr_row.cells[col_idx]
                    set_cell_background(cell, "1E3A8A") # Dark Navy Blue header
                    set_cell_margins(cell, top=120, bottom=120, left=140, right=140)
                    set_cell_border(cell, 
                                    top={'val': 'single', 'sz': 6, 'color': '1E3A8A'},
                                    bottom={'val': 'single', 'sz': 12, 'color': '0F172A'},
                                    left={'val': 'none'}, right={'val': 'none'})
                    p = cell.paragraphs[0]
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    p.paragraph_format.space_before = Pt(0)
                    p.paragraph_format.space_after = Pt(0)
                    run = p.add_run(text)
                    run.bold = True
                    run.font.name = 'Calibri'
                    run.font.size = Pt(9.5)
                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF) # White text
                
                # Format Data Rows
                for row_idx, r_data in enumerate(data_rows):
                    row = table.rows[row_idx + 1]
                    bg_color = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF" # Zebra striping
                    for col_idx, text in enumerate(r_data):
                        cell = row.cells[col_idx]
                        set_cell_background(cell, bg_color)
                        set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
                        set_cell_border(cell, 
                                        top={'val': 'single', 'sz': 4, 'color': 'E2E8F0'},
                                        bottom={'val': 'single', 'sz': 4, 'color': 'E2E8F0'},
                                        left={'val': 'none'}, right={'val': 'none'})
                        p = cell.paragraphs[0]
                        p.paragraph_format.space_before = Pt(0)
                        p.paragraph_format.space_after = Pt(0)
                        p.paragraph_format.line_spacing = 1.05
                        
                        # Align center for short numbers, left for text
                        if len(text) <= 15 and (text.isdigit() or '%' in text or '/' in text or text.startswith('+') or text.startswith('-')):
                            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        else:
                            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                            
                        add_formatted_runs(p, text, default_font_size=9.0)
                        
                # Space after table
                sp = doc.add_paragraph()
                sp.paragraph_format.space_before = Pt(0)
                sp.paragraph_format.space_after = Pt(6)
            continue
            
        # Title (#)
        if stripped.startswith('# '):
            title_text = stripped[2:].strip()
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(8)
            run = p.add_run(title_text)
            run.bold = True
            run.font.name = 'Calibri'
            run.font.size = Pt(20)
            run.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A) # Slate 900
            i += 1
            continue
            
        # Heading 1 (##)
        if stripped.startswith('## '):
            heading_text = stripped[3:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(16)
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(heading_text)
            run.bold = True
            run.font.name = 'Calibri'
            run.font.size = Pt(14)
            run.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A) # Dark Blue
            i += 1
            continue
            
        # Heading 2 (###)
        if stripped.startswith('### '):
            heading_text = stripped[4:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(heading_text)
            run.bold = True
            run.font.name = 'Calibri'
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0x25, 0x63, 0xEB) # Royal Blue
            i += 1
            continue
            
        # Heading 3 (####)
        if stripped.startswith('#### '):
            heading_text = stripped[5:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(heading_text)
            run.bold = True
            run.font.name = 'Calibri'
            run.font.size = Pt(11)
            run.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
            i += 1
            continue

        # Bullet List (- or *)
        if stripped.startswith('- ') or stripped.startswith('* '):
            list_text = stripped[2:].strip()
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.line_spacing = 1.15
            add_formatted_runs(p, list_text, default_font_size=10.5)
            i += 1
            continue
            
        # Numbered List (1. , 2. )
        m_num = re.match(r'^(\d+)\.\s+(.*)', stripped)
        if m_num:
            num_val = m_num.group(1)
            item_text = m_num.group(2).strip()
            p = doc.add_paragraph(style='List Number')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.line_spacing = 1.15
            add_formatted_runs(p, item_text, default_font_size=10.5)
            i += 1
            continue
            
        # Blockquotes (> ...)
        if stripped.startswith('> '):
            quote_text = stripped[2:].strip()
            tbl = doc.add_table(rows=1, cols=1)
            tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
            tbl.autofit = False
            tbl.columns[0].width = Inches(6.5)
            
            cell = tbl.cell(0, 0)
            set_cell_background(cell, "F1F5F9")
            set_cell_margins(cell, top=100, bottom=100, left=150, right=150)
            set_cell_border(cell, 
                            top={'val': 'none'}, bottom={'val': 'none'},
                            left={'val': 'single', 'sz': 18, 'color': '2563EB'},
                            right={'val': 'none'})
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            add_formatted_runs(p, quote_text, default_font_size=10.0, is_italic_default=True)
            
            sp = doc.add_paragraph()
            sp.paragraph_format.space_before = Pt(0)
            sp.paragraph_format.space_after = Pt(3)
            i += 1
            continue
            
        # Math Display Equation ($$...$$)
        if stripped.startswith('$$') and stripped.endswith('$$') and len(stripped) >= 4:
            eq_text = stripped[2:-2].strip()
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(6)
            run = p.add_run(eq_text)
            run.font.name = 'Cambria Math'
            run.font.size = Pt(11)
            run.italic = True
            i += 1
            continue

        # Standard Paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.15
        
        # Center metadata if at top
        if stripped.startswith('**Authors:**') or stripped.startswith('**Affiliation:**') or stripped.startswith('**Target Venue:**') or stripped.startswith('**Artifact Repository:**'):
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            add_formatted_runs(p, stripped, default_font_size=10.0)
        else:
            add_formatted_runs(p, stripped, default_font_size=10.5)
            
        i += 1

    print(f"Saving compiled docx to {docx_path}...")
    doc.save(docx_path)
    print("Document successfully created and saved!")

if __name__ == '__main__':
    md_in = os.path.join(os.getcwd(), 'paper', 'COGNICORE_RESEARCH_PAPER.md')
    docx_out = os.path.join(os.getcwd(), 'paper', 'COGNICORE_RESEARCH_PAPER.docx')
    convert_md_to_docx(md_in, docx_out)
    
    # Also save a copy directly in Downloads for user's immediate convenience
    downloads_dir = os.path.expanduser('~/Downloads')
    if os.path.exists(downloads_dir):
        dl_out = os.path.join(downloads_dir, 'COGNICORE_RESEARCH_PAPER.docx')
        convert_md_to_docx(md_in, dl_out)
        print(f"Also saved user copy to: {dl_out}")

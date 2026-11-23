import json,subprocess,sys,os,re
rows=json.load(open(sys.argv[1])); out=sys.argv[2]; os.makedirs(out,exist_ok=True)
D="/root/Brahmastra_OCR_Eroll/raw-gbn/Uttar Pradesh/63-Jewar-2026-Final"
DPI=130; body=(0.034,0.962,0.02,0.98); cols,nrows=3,10
for i,r in enumerate(rows):
    pdf=f"{D}/2026-EROLLGEN-S24-63-SIR-FinalRoll-Revision1-HIN-{r['part']}-WI.pdf"
    info=subprocess.run(["pdfinfo","-f",str(r['page']),"-l",str(r['page']),pdf],capture_output=True,text=True).stdout
    m=re.search(r"Page\s+%d size:\s+([\d.]+) x ([\d.]+)"%r['page'],info) or re.search(r"Page size:\s+([\d.]+) x ([\d.]+)",info)
    W=float(m.group(1))*DPI/72; H=float(m.group(2))*DPI/72
    top,bot,left,right=body; bw=(right-left)*W/cols; bh=(bot-top)*H/nrows
    idx=r['idx']; rr,cc=divmod(idx,cols)
    x=int(left*W+cc*bw); y=int(top*H+rr*bh)
    name=f"{out}/{i:02d}_{r['epic']}_{r['status']}_p{r['part']}"
    subprocess.run(["pdftoppm","-r",str(DPI),"-f",str(r['page']),"-l",str(r['page']),"-x",str(x),"-y",str(y),"-W",str(int(bw)),"-H",str(int(bh)),"-png","-singlefile",pdf,name],check=True)
    print(name)

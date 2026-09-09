import { gzipSync } from 'zlib';
import { poiCatalogFromAgentResult } from './poi-catalog';

const catalogGz = gzipSync(Buffer.from('house_01\t1\nno_preview\t0\n../bad\t1\n', 'utf8')).toString('base64');
const catalog = poiCatalogFromAgentResult({ catalogGz });
if (catalog.count !== 2) throw new Error(`count=${catalog.count}`);
if (!catalog.items.find(item => item.name === 'house_01')?.hasPreview) throw new Error('preview flag missing');
if (catalog.items.find(item => item.name === '../bad')) throw new Error('unsafe name accepted');

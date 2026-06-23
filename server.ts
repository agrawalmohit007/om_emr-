import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { db } from "./src/db/index.js";
import { 
  fallbackStore, appSettings, patients, visits, labOrders, consultants, systemUsers, ipdAdmissions,
  pharmacyItems, pharmacySales, savedReports, clinicalTemplates, labInventoryItems, wards
} from "./src/db/schema.js";
import { eq, sql } from "drizzle-orm";
import { EventEmitter } from "events";

const eventEmitter = new EventEmitter();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/stream", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); 

    const onUpdate = (collection: string) => {
        res.write(`data: ${JSON.stringify({ collection })}\n\n`);
    };

    eventEmitter.on('update', onUpdate);

    req.on('close', () => {
        eventEmitter.off('update', onUpdate);
    });
  });

  app.get("/api/collection/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

      const fetchTable = async (table: any) => {
        let query: any = db.select().from(table);
        if (limit !== undefined) query = query.limit(limit);
        if (offset !== undefined) query = query.offset(offset);
        const payload = await query;
        const response: any = { payload, updatedAt: new Date() };

        if (limit !== undefined || offset !== undefined) {
          const [{ count }] = await db.select({ count: sql`count(*)` }).from(table);
          response.totalCount = Number(count);
          response.limit = limit;
          response.offset = offset;
        }

        return res.json(response);
      };

      if (id === 'patients') {
          return fetchTable(patients);
      } else if (id === 'visits') {
          return fetchTable(visits);
      } else if (id === 'labOrders') {
          return fetchTable(labOrders);
      } else if (id === 'consultants') {
          return fetchTable(consultants);
      } else if (id === 'systemUsers') {
          return fetchTable(systemUsers);
      } else if (id === 'ipdAdmissions') {
          return fetchTable(ipdAdmissions);
      } else if (id === 'pharmacyInventory') {
          return fetchTable(pharmacyItems);
      } else if (id === 'pharmacySales') {
          return fetchTable(pharmacySales);
      } else if (id === 'reportHistory') {
          return fetchTable(savedReports);
      } else if (id === 'clinicalTemplates') {
          return fetchTable(clinicalTemplates);
      } else if (id === 'labInventory') {
          return fetchTable(labInventoryItems);
      } else if (id === 'wards') {
          return fetchTable(wards);
      }

      // Check appSettings
      const settingResult = await db.select().from(appSettings).where(eq(appSettings.key, id));
      if (settingResult.length > 0) {
        return res.json({ payload: settingResult[0].value, updatedAt: settingResult[0].updatedAt });
      }

      // Fallback
      const result = await db.select().from(fallbackStore).where(eq(fallbackStore.collection, id));
      if (result.length > 0) {
        let payload = result[0].payload as any[];
        let totalCount;
        if (Array.isArray(payload)) {
          if (limit !== undefined || offset !== undefined) {
            totalCount = payload.length;
            const start = offset || 0;
            const end = limit !== undefined ? start + limit : undefined;
            payload = payload.slice(start, end);
          }
        }
        const resp: any = { payload, updatedAt: result[0].updatedAt };
        if (totalCount !== undefined) {
          resp.totalCount = totalCount;
          resp.limit = limit;
          resp.offset = offset;
        }
        res.json(resp);
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (error: any) {
      console.error(`Error reading collection ${req.params.id}:`, error.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/api/collection/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let { payload } = req.body;
      
      const isObjectInsteadOfArray = !Array.isArray(payload);
      const itemsToUpdate = isObjectInsteadOfArray ? [payload] : payload;

      if (id === 'patients') {
          for (const p of itemsToUpdate) {
             const createdAt = p.createdAt ? new Date(p.createdAt) : new Date();
             const mappedData = { ...p, uhid: p.uhid || `UHID-${p.id}`, createdAt };
             const { id: _, ...mappedRest } = mappedData;
             await db.insert(patients).values(mappedData).onConflictDoUpdate({ target: patients.id, set: mappedRest });
          }
      } else if (id === 'visits') {
          for (const v of itemsToUpdate) {
             const createdAt = v.createdAt ? new Date(v.createdAt) : new Date();
             const mappedData = { ...v, createdAt };
             const { id: _, ...mappedRest } = mappedData;
             await db.insert(visits).values(mappedData).onConflictDoUpdate({ target: visits.id, set: mappedRest });
          }
      } else if (id === 'labOrders') {
          for (const l of itemsToUpdate) {
             const { id: _, ...rest } = l;
             await db.insert(labOrders).values(l).onConflictDoUpdate({ target: labOrders.id, set: { ...rest } });
          }
      } else if (id === 'consultants') {
          for (const c of itemsToUpdate) {
             const { id: _, ...rest } = c;
             await db.insert(consultants).values(c).onConflictDoUpdate({ target: consultants.id, set: { ...rest } });
          }
      } else if (id === 'systemUsers') {
          for (const u of itemsToUpdate) {
             const { id: _, ...rest } = u;
             await db.insert(systemUsers).values(u).onConflictDoUpdate({ target: systemUsers.id, set: { ...rest } });
          }
      } else if (id === 'ipdAdmissions') {
          for (const a of itemsToUpdate) {
             const { id: _, ...rest } = a;
             await db.insert(ipdAdmissions).values(a).onConflictDoUpdate({ target: ipdAdmissions.id, set: { ...rest } });
          }
      } else if (id === 'pharmacyInventory') {
          for (const i of itemsToUpdate) {
             const { id: _, ...rest } = i;
             await db.insert(pharmacyItems).values(i).onConflictDoUpdate({ target: pharmacyItems.id, set: { ...rest } });
          }
      } else if (id === 'pharmacySales') {
          for (const s of itemsToUpdate) {
             const { id: _, ...rest } = s;
             await db.insert(pharmacySales).values(s).onConflictDoUpdate({ target: pharmacySales.id, set: { ...rest } });
          }
      } else if (id === 'reportHistory') {
          for (const r of itemsToUpdate) {
             const reportId = r.id || `report_${r.timestamp}`;
             const mappedData = { ...r, id: reportId };
             const { id: _, ...rest } = mappedData;
             await db.insert(savedReports).values(mappedData).onConflictDoUpdate({ target: savedReports.id, set: { ...rest } });
          }
      } else if (id === 'clinicalTemplates') {
          for (const t of itemsToUpdate) {
             const { id: _, ...rest } = t;
             await db.insert(clinicalTemplates).values(t).onConflictDoUpdate({ target: clinicalTemplates.id, set: { ...rest } });
          }
      } else if (id === 'labInventory') {
          for (const l of itemsToUpdate) {
             const { id: _, ...rest } = l;
             await db.insert(labInventoryItems).values(l).onConflictDoUpdate({ target: labInventoryItems.id, set: { ...rest } });
          }
      } else if (id === 'wards') {
          for (const w of itemsToUpdate) {
             const { id: _, ...rest } = w;
             await db.insert(wards).values(w).onConflictDoUpdate({ target: wards.id, set: { ...rest } });
          }
      } else if (id === 'medicationMaster' || id === 'billingRates' || id === 'printSettings' || id === 'hospitalInfo') {
          // Store directly as JSON object/array in appSettings
          await db.insert(appSettings).values({ key: id, value: req.body.payload })
            .onConflictDoUpdate({ target: appSettings.key, set: { value: req.body.payload, updatedAt: new Date() } });
      } else {
          // Store in fallbackStore for non-normalized collections
          const existing = await db.select().from(fallbackStore).where(eq(fallbackStore.collection, id));
          if (existing.length > 0) {
            await db.update(fallbackStore)
              .set({ payload: req.body.payload, updatedAt: new Date() })
              .where(eq(fallbackStore.collection, id));
          } else {
            await db.insert(fallbackStore)
              .values({ collection: id, payload: req.body.payload, updatedAt: new Date() });
          }
      }

      eventEmitter.emit('update', id);
      res.json({ success: true });
    } catch (error: any) {
      console.error(`Error writing collection ${req.params.id}:`, error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 5, simply use a catch-all middleware instead of path-to-regexp wildcards
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

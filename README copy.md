
  # Jira Integration Workflow

  This is a code bundle for Jira Integration Workflow. The original project is available at https://www.figma.com/design/409y8xxEi4F8JBAorGp64Z/Jira-Integration-Workflow.

  ## Running the code

Run `npm i` to install the dependencies.

### Backend (FastAPI)

The backend service now lives under `backend/` and follows a conventional FastAPI layout.

1. Install Python dependencies:

   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. (Optional) Configure the database. By default the backend stores data in `backend/data/app.db` and JSON fixtures. To use PostgreSQL, set `DATABASE_URL` before starting the server:

   ```bash
   export DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/jira_integration"
   ```

3. Start the API server:

   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

   The frontend expects the API on `http://localhost:8000`. Adjust `VITE_API_BASE_URL` if you use a different port.
   Persistent data lives in `backend/data`, so add it to your personal `.gitignore` if you don't want to commit local fixtures.

### Frontend (Vite + React)

Create a `.env.local` file in the project root (next to `package.json`) and set the API base URL if you are not using the default port:

```
VITE_API_BASE_URL=http://localhost:8000
```

Run `npm run dev` to start the development server.
  

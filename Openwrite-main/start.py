import sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uvicorn
if __name__ == "__main__":
    uvicorn.run(
        "server.main:app",
        host=os.environ.get("OPENWRITE_HOST", "127.0.0.1"),
        port=int(os.environ.get("OPENWRITE_PORT", "8001")),
    )

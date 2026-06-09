import sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uvicorn
if __name__ == "__main__":
    uvicorn.run("server.main:app", host="127.0.0.1", port=8000)

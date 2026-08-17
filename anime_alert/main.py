import kivy
kivy.require('2.2.1')
from kivy.app import App
from kivy.uix.label import Label
from kivy.clock import Clock
import threading
import subprocess
import os
import sys

# Add the current directory to path so we can import anime_alert
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def run_alert_loop():
    # Import the main script and run its loop
    import anime_alert
    # anime_alert.main() is called in a while True with sleep, so we'll run it in a thread
    # But we need to call the main function in a way that doesn't block the UI.
    # The script has a while True loop, so we'll start it in a thread.
    def worker():
        try:
            # The script will run indefinitely; we'll import and let it run.
            # We'll call its main function, which contains the infinite loop.
            anime_alert.main()  # This will block, so we run it in a thread.
        except Exception as e:
            print("Alert loop error:", e)
    t = threading.Thread(target=worker, daemon=True)
    t.start()

class AnimeAlertApp(App):
    def build(self):
        self.label = Label(text="Anime Alert is running in the background.", font_size='20sp')
        Clock.schedule_once(lambda dt: self.start_service(), 1)
        return self.label
    def start_service(self):
        # Start the alert loop in a background thread
        threading.Thread(target=run_alert_loop, daemon=True).start()

if __name__ == '__main__':
    AnimeAlertApp().run()

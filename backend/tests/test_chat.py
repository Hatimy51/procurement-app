import io

def test_send_chat_message_with_text_only(authed_client):
    """Test posting a text-only chat message via FormData."""
    resp = authed_client.post(
        "/api/chat/messages",
        data={"message": "Hello from backend test"},
    )
    assert resp.status_code == 200, f"Error: {resp.text}"
    msg = resp.json()
    assert msg["message"] == "Hello from backend test"
    assert msg["file_url"] is None


def test_send_chat_message_with_file_attachment(authed_client):
    """Test uploading a file attachment in chat and downloading it."""
    file_content = b"Sample CSV Data: item,quantity\nWidget,100"
    file_data = {
        "file": ("test_data.csv", io.BytesIO(file_content), "text/csv"),
    }
    form_data = {
        "message": "Here is the CSV report",
    }

    resp = authed_client.post(
        "/api/chat/messages",
        data=form_data,
        files=file_data,
    )
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    msg = resp.json()

    assert msg["message"] == "Here is the CSV report"
    assert msg["file_name"] == "test_data.csv"
    assert msg["file_url"] is not None

    # Test downloading the uploaded file
    file_url = msg["file_url"]
    dl_resp = authed_client.get(file_url)
    assert dl_resp.status_code == 200
    assert dl_resp.content == file_content

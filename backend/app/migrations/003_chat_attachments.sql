-- Migration: Add file attachment columns to chat_messages table
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_type VARCHAR(100);

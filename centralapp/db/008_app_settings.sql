-- app-wide settings; holds the admin password hash once it is changed from the admin pages
create table if not exists app_settings(key text primary key, value text not null);
